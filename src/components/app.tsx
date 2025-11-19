import React, { FunctionComponent } from 'react';
import styled from 'styled-components';
import { ZakekeEnvironment, ZakekeViewer, ZakekeProvider } from 'zakeke-configurator-react';
import Selector from './selector';

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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-gap: 40px;
  height: 100%;
  max-height: 100%;
  padding: 40px;

  @media (max-width: 767px) {
    display: flex;
    flex-direction: column;
    padding: 16px;
    gap: 12px;
  }
`;

const SelectorPanel = styled.div`
  min-height: 0;

  @media (max-width: 767px) {
    order: 1;
    flex: 0 0 40%;
  }
`;

const ViewerPanel = styled.div`
  min-height: 0;

  @media (max-width: 767px) {
    order: 0;
    flex: 0 0 60%;
  }
`;

const zakekeEnvironment = new ZakekeEnvironment();

const App: FunctionComponent<{}> = () => {
    const bootstrapParameters = getBootstrapParameters();
    return <ZakekeProvider environment={zakekeEnvironment} parameters={bootstrapParameters}>
        <Layout>
            <ViewerPanel>
                <ZakekeViewer />
            </ViewerPanel>
        </Layout>
    </ZakekeProvider>;
}

export default App; 
