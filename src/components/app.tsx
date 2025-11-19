import React, { FunctionComponent, useCallback, useEffect, useRef } from 'react';
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
  padding: 40px;
  align-items: center;
  justify-items: center;

  @media (max-width: 767px) {
    display: flex;
    flex-direction: column;
    padding: 16px;
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

  @media (max-width: 767px) {
    order: 0;
    flex: 0 0 60%;
    width: 100%;
  }
`;

const zakekeEnvironment = new ZakekeEnvironment();

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
      await setCameraByName(name);
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
    return <ZakekeProvider environment={zakekeEnvironment} parameters={bootstrapParameters}>
        <Layout>
            <ViewerPanel>
                <ZakekeViewer />
                <SimpleCameraTour />
            </ViewerPanel>
        </Layout>
    </ZakekeProvider>;
}

export default App; 
