import React, { FunctionComponent, useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { ZakekeEnvironment, ZakekeViewer, ZakekeProvider, useZakeke } from 'zakeke-configurator-react';

// Allow reading bootstrap params that we inject via URL or a window shim
declare global {
  interface Window {
    __ZAKEKE_BOOT_PARAMS__?: Record<string, any>;
  }
}

function decodeBase64Json(input?: string | null) {
  if (!input) return undefined;
  try {
    const json = decodeURIComponent(escape(atob(String(input))));
    return JSON.parse(json);
  } catch (_) {
    return undefined;
  }
}

function getBootstrapParameters(): Record<string, any> {
  const params = new URLSearchParams(window.location.search);
  const urlParameters: Record<string, any> = Object.fromEntries(params.entries());

  // If attributes are passed as base64 JSON in `attrs_b64`, decode them
  const decodedAttrs = decodeBase64Json(urlParameters["attrs_b64"]);
  if (decodedAttrs) {
    urlParameters["attributes"] = decodedAttrs;
  }

  // Merge with any pre-baked params that the host page defines
  const shim = (window as any).__ZAKEKE_BOOT_PARAMS__ || {};
  return { ...urlParameters, ...shim };
}

const Layout = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-gap: 40px;
  height: 100%;
  max-height: 100%;
  padding: 0px 40px;
  align-items: center;
  justify-items: center;
  overflow: hidden;

  @media (max-width: 767px) {
    display: flex;
    flex-direction: column;
    padding: 0px 16px;
    gap: 12px;
    justify-content: center;
    align-items: center;
  }
`;

const ViewerPanel = styled.div`
  min-height: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;

  @media (max-width: 767px) {
    order: 0;
    flex: 1 1 auto;
    width: 100%;
  }
`;

const zakekeEnvironment = new ZakekeEnvironment();

const __IS_SAFARI__ = typeof navigator !== 'undefined' && /safari/i.test(navigator.userAgent) && !/chrome|crios|android/i.test(navigator.userAgent);

type ReadySignalProps = {
  onFirstRenderSent?: () => void;
};

const ReadySignal: FunctionComponent<ReadySignalProps> = ({ onFirstRenderSent }) => {
  const { isAssetsLoading, isSceneLoading, isViewerReady, product, groups, price } = useZakeke();
  const firstRenderPostedRef = useRef(false);
  const readyAckedRef = useRef(false);
  const readyMsgIdRef = useRef<string>('');
  if (!readyMsgIdRef.current) {
    const t = Date.now();
    const r = Math.floor(Math.random() * 1e9);
    readyMsgIdRef.current = `ready-${t}-${r}`;
  }
  const readyRetryTimer1 = useRef<number | null>(null);
  const readyRetryTimer2 = useRef<number | null>(null);

  const [safariGraceReady, setSafariGraceReady] = useState(false);
  useEffect(() => {
    if (!__IS_SAFARI__) return;
    const t = window.setTimeout(() => setSafariGraceReady(true), 6000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const payload = e.data;
      if (payload && typeof payload === 'object' && payload.customMessageType === 'firstRenderAck') {
        const cid = payload?.meta?.correlationId || payload?.correlationId;
        if (cid && cid === readyMsgIdRef.current) {
          readyAckedRef.current = true;
          if (readyRetryTimer1.current) { clearTimeout(readyRetryTimer1.current as any); readyRetryTimer1.current = null; }
          if (readyRetryTimer2.current) { clearTimeout(readyRetryTimer2.current as any); readyRetryTimer2.current = null; }
        }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    const assetsOk = isAssetsLoading === false && isSceneLoading === false;
    const viewerOk = typeof isViewerReady === 'boolean'
      ? (__IS_SAFARI__ ? isViewerReady === true : isViewerReady === true)
      : true;
    const basicsOk = !!product && Array.isArray(groups) && groups.length > 0;
    const pricedOk = price != null;
    let isReady = assetsOk && viewerOk && basicsOk && pricedOk;
    if (__IS_SAFARI__ && !isReady) {
      const almostReady = assetsOk && basicsOk && pricedOk && !viewerOk;
      if (almostReady && safariGraceReady) {
        isReady = true;
      }
    }

    if (isReady && !firstRenderPostedRef.current) {
      firstRenderPostedRef.current = true;

      const correlationId = readyMsgIdRef.current;
      const basePayload = { customMessageType: 'firstRender', message: { closeLoadingScreen: true }, meta: { iframeOrigin: window.location.origin, correlationId } } as const;

      const send = (stage: 'immediate' | 'retry1' | 'retry2') => {
        try {
          window.parent?.postMessage(basePayload, '*');
          window.top?.postMessage(basePayload, '*');
          // console.log('[READY EFFECT] postMessage:', stage, basePayload.meta);
        } catch (e) {
          console.error('[READY EFFECT] postMessage failed', stage, e);
        }
      };

      send('immediate');
      onFirstRenderSent?.();

      readyRetryTimer1.current = window.setTimeout(() => {
        if (!readyAckedRef.current) send('retry1');
      }, 300);

      readyRetryTimer2.current = window.setTimeout(() => {
        if (!readyAckedRef.current) send('retry2');
      }, 1000);
    }
    return () => {
      if (readyRetryTimer1.current) { clearTimeout(readyRetryTimer1.current as any); readyRetryTimer1.current = null; }
      if (readyRetryTimer2.current) { clearTimeout(readyRetryTimer2.current as any); readyRetryTimer2.current = null; }
    };
  }, [isAssetsLoading, isSceneLoading, isViewerReady, price, product, groups, safariGraceReady]);

  return null;
};

const SimpleCameraTour: FunctionComponent<{}> = () => {
  const { isViewerReady, isSceneLoading, setCameraByName } = useZakeke();
  const hasRunRef = useRef(false);
  const camAbort = useRef<AbortController | null>(null);

  const waitSceneIdle = useCallback(async (timeout = 1500, interval = 60) => {
    const start = Date.now();
    let stable = 0;
    while (Date.now() - start < timeout) {
      if (!isSceneLoading) {
        stable++;
        if (stable >= 2) break;
      } else {
        stable = 0;
      }
      await new Promise(r => setTimeout(r, interval));
    }
    await new Promise(r => requestAnimationFrame(() => r(null)));
  }, [isSceneLoading]);

  const moveCamera = useCallback(async (name: string) => {
    try {
      // last two args: keep animation and force transition even if already on that cam
      await setCameraByName(name, false, true);
    } catch (e) {
      console.warn('[CameraTour] Failed to set camera', name, e);
    }
  }, [setCameraByName]);

  const runTour = useCallback(async () => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    camAbort.current?.abort();
    const ctrl = new AbortController();
    camAbort.current = ctrl;

    const sequence = ['wide_high_back', 'wide_low_front', 'wide_full_front'];

    try {
      await waitSceneIdle(1500, 60);
      for (const cam of sequence) {
        if (ctrl.signal.aborted) return;
        await moveCamera(cam);
        if (ctrl.signal.aborted) return;
        await new Promise(r => setTimeout(r, 900));
        await waitSceneIdle(1200, 80);
      }
    } finally {
      if (camAbort.current === ctrl) camAbort.current = null;
    }
  }, [moveCamera, waitSceneIdle]);

  useEffect(() => {
    if (!isViewerReady) return;
    runTour();
    return () => camAbort.current?.abort();
  }, [isViewerReady, runTour]);

  return null;
};

const App: FunctionComponent<{}> = () => {
    const bootstrapParameters = getBootstrapParameters();
    const [readySignalSent, setReadySignalSent] = useState(false);
    return <ZakekeProvider environment={zakekeEnvironment} parameters={bootstrapParameters}>
        <Layout>
            <ViewerPanel>
                <ZakekeViewer />
                <ReadySignal onFirstRenderSent={() => setReadySignalSent(true)} />
                {readySignalSent && <SimpleCameraTour />}
            </ViewerPanel>
        </Layout>
    </ZakekeProvider>;
}

export default App; 
