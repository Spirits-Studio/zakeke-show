import React, { FunctionComponent, useEffect, useMemo, useRef, useState, useCallback } from 'react';
// import styled from 'styled-components';
import { useZakeke } from 'zakeke-configurator-react';
import { LayoutWrapper, ContentWrapper, Container, OptionListItem, RotateNotice, LoadingSpinner, NotesWrapper, CartBar, StepNav, OptionsWrap, OptionText, OptionTitle, OptionDescription, ActionsCenter, ConfigWarning, ViewportSpacer, CartButton } from './list';
// import { List, StepListItem, , ListItemImage } from './list';
import { optionNotes } from '../data/option-notes';
// import { ClipLoader } from 'react-loader-spinner';
import ClipLoader from 'react-spinners/ClipLoader';

import { useOrderStore } from '../state/orderStore';

// ---- Safari / legacy polyfills & diagnostics ----
// Polyfill Array.prototype.flatMap for older Safari builds
if (!Array.prototype.flatMap) {
  // eslint-disable-next-line no-extend-native
  Object.defineProperty(Array.prototype, 'flatMap', {
    configurable: true,
    writable: true,
    value: function flatMap<T, U>(this: T[], mapper: (v: T, i: number, a: T[]) => U | U[]): U[] {
      const out: any[] = [];
      for (let i = 0; i < this.length; i += 1) {
        if (i in this) {
          const r = mapper(this[i], i, this);
          if (Array.isArray(r)) out.push.apply(out, r);
          else out.push(r);
        }
      }
      return out as U[];
    }
  });
}

// Light shims frequently missing on Safari versions we still encounter
if (!('requestIdleCallback' in window)) {
  // @ts-ignore
  window.requestIdleCallback = (cb: any) => setTimeout(() => cb(Date.now()), 1);
}
if (!('structuredClone' in window)) {
  // @ts-ignore
  window.structuredClone = (o: any) => JSON.parse(JSON.stringify(o));
}

// Robust Safari detection (exclude Chrome/iOS Chrome/Android UA overlays)
const __IS_SAFARI__ = typeof navigator !== 'undefined' && /safari/i.test(navigator.userAgent) && !/chrome|crios|android/i.test(navigator.userAgent);

// Early environment diagnostics (safe to keep in production; helps field debugging)
try {
  const webglSupport = (() => {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch { return false; }
  })();
  let storageOk = true;
  try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); } catch { storageOk = false; }
  // eslint-disable-next-line no-console
  console.log('[ENV]', { safari: __IS_SAFARI__, ua: navigator.userAgent, webglSupport, storageOk });
} catch {}


const slugify = (value: string) =>
  (value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');

const titleize = (slug: string) =>
  slug
    .replace(/[^a-z0-9_-]/gi, ' ')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const formatList = (items: string[]) => {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
};

const syntheticIdFromSlug = (slug: string) => {
  let hash = 0;
  for (let i = 0; i < slug.length; i += 1) {
    hash = ((hash << 5) - hash) + slug.charCodeAt(i);
    hash |= 0;
  }
  const normalized = Math.abs(hash) || 1;
  return -normalized;
};

const buildSyntheticBottle = (slug: string) => {
  if (!slug) return null;
  return {
    slug,
    mini: {
      id: syntheticIdFromSlug(slug),
      guid: `synthetic-${slug}`,
      name: titleize(slug),
      selected: true,
    },
    option: null,
  };
};

const DEFAULT_BOTTLE_SLUG = 'antica';
const DEFAULT_BOTTLE = buildSyntheticBottle(DEFAULT_BOTTLE_SLUG) ?? {
  slug: DEFAULT_BOTTLE_SLUG,
  mini: {
    id: syntheticIdFromSlug(DEFAULT_BOTTLE_SLUG),
    guid: `synthetic-${DEFAULT_BOTTLE_SLUG}`,
    name: titleize(DEFAULT_BOTTLE_SLUG),
    selected: true,
  },
  option: null,
};

const slugFromOption = (option: any) => {
  if (!option) return '';
  const code = typeof option?.code === 'string' ? option.code : '';
  if (code) {
    const normalized = slugify(code.split('|').pop() || code);
    if (normalized) return normalized;
  }
  return slugify(option?.name || '');
};

const toMini = (o: any) =>
  o ? ({ id: o.id, guid: o.guid, name: o.name, selected: !!o.selected }) : null;

const sleep = (ms: number) => new Promise<void>(resolve => {
  if (ms <= 0) {
    resolve();
    return;
  }
  setTimeout(resolve, ms);
});

const CAMERA_PREVIEW_SETTLE_MS = 800;

type LabelDesignSource = 'vistaCreate' | 'ai' | 'upload';

type LabelSelectionDetail = {
  s3Url: string | null;
  zakekeMediaUrl: string | null;
  zakekePreviewUrl: string | null;
  designSource: LabelDesignSource;
  designSourceId: string | null;
};

type LabelSelectionsBySide = {
  front: LabelSelectionDetail | null;
  back: LabelSelectionDetail | null;
};

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
};

const normalizeDesignSource = (
  value: unknown,
  fallback: LabelDesignSource = 'upload'
): LabelDesignSource => {
  const raw = toTrimmedString(value);
  if (!raw) return fallback;
  const normalized = raw.toLowerCase();
  if (normalized.includes('vista')) return 'vistaCreate';
  if (normalized === 'vc') return 'vistaCreate';
  if (normalized === 'ai' || normalized.includes('ai')) return 'ai';
  if (normalized === 'upload') return 'upload';
  return fallback;
};

const buildLabelSelectionDetail = (
  design: any,
  options: {
    fallbackSource?: LabelDesignSource;
    overrides?: Partial<LabelSelectionDetail>;
  } = {}
): LabelSelectionDetail | null => {
  const { fallbackSource = 'upload', overrides = {} } = options;
  const safe = design && typeof design === 'object' ? design : null;

  const s3Url =
    overrides.s3Url ??
    toTrimmedString(safe?.s3Url) ??
    toTrimmedString(safe?.s3url) ??
    toTrimmedString(safe?.url);

  const zakekeMediaUrl =
    overrides.zakekeMediaUrl ??
    toTrimmedString(safe?.zakekeMediaUrl) ??
    toTrimmedString(safe?.mediaUrl) ??
    toTrimmedString(safe?.zakekeMedia?.url) ??
    toTrimmedString(safe?.media?.url);

  const zakekePreviewUrl =
    overrides.zakekePreviewUrl ??
    toTrimmedString(safe?.zakekePreviewUrl) ??
    toTrimmedString(safe?.previewUrl) ??
    toTrimmedString(safe?.preview?.url) ??
    toTrimmedString(safe?.preview);

  const designSourceId =
    overrides.designSourceId ??
    toTrimmedString(safe?.designSourceId) ??
    toTrimmedString(safe?.sourceId) ??
    toTrimmedString(safe?.id) ??
    toTrimmedString(safe?.designId) ??
    toTrimmedString(safe?.design_id);

  const designSource =
    overrides.designSource ??
    normalizeDesignSource(
      toTrimmedString(safe?.designSource) ?? toTrimmedString(safe?.source),
      fallbackSource
    );

  const hasValue =
    s3Url ||
    zakekeMediaUrl ||
    zakekePreviewUrl ||
    designSourceId ||
    overrides.designSource ||
    overrides.designSourceId;

  if (!hasValue) return null;

  return {
    s3Url: s3Url ?? null,
    zakekeMediaUrl: zakekeMediaUrl ?? null,
    zakekePreviewUrl: zakekePreviewUrl ?? null,
    designSource,
    designSourceId: designSourceId ?? null,
  };
};

const Selector: FunctionComponent<{}> = () => {
    const {
        isSceneLoading,
        isAddToCartLoading,
        price,
        groups,
        selectOption,
        addToCart,
        setCameraByName,
        product,
        items,
        getMeshIDbyName,
        isAreaVisible,
        createImageFromUrl, 
        addItemImage,
        cameras,
        // removeItem,
        isAssetsLoading,
        isViewerReady,
        // templates,
        // setTemplate,
        // setMeshDesignVisibility,
        // restoreMeshVisibility,
    } = useZakeke();

    // if (process.env.NODE_ENV !== 'production') console.log('[groups]', groups);
    // if (process.env.NODE_ENV !== 'production') console.log('[items]', Array.isArray(items) ? items.length : 'n/a');


    const allowedParentOrigins = useMemo(() => {
      const envList = (['https://create.spiritsstudio.co.uk','https://spiritsstudio.co.uk', 'http://localhost:3000', 'https://localhost:3000', 'http://127.0.0.1:9292'])
        .map(origin => origin.trim())
        .filter(Boolean);
      const globalList =
        typeof window !== 'undefined' && Array.isArray((window as any).__ZAKEKE_PARENT_ORIGINS)
          ? ((window as any).__ZAKEKE_PARENT_ORIGINS as string[])
          : [];
      const normalizedGlobal = globalList
        .map(origin => origin.trim())
        .filter(Boolean);
      return Array.from(new Set([...envList, ...normalizedGlobal]));
    }, []);

    const setFromSelections   = useOrderStore(state => state.setFromSelections);
    const labelDesigns        = useOrderStore(state => state.labelDesigns);
    const setFromUploadDesign = useOrderStore(state => state.setFromUploadDesign);

    const primaryGroup = useMemo(() => {
      if (!Array.isArray(groups)) return null;
      const withSteps = groups.find(g => Array.isArray(g?.steps) && g.steps.length > 0);
      return withSteps ?? null;
    }, [groups]);

    const steps = useMemo(() => primaryGroup?.steps ?? [], [primaryGroup]);

    type StepRole = 'bottle' | 'liquid' | 'closure' | 'label' | 'unknown';

    const bottleNameSet = useMemo(() => new Set(
      Object.keys(optionNotes.bottles || {}).map(name => name.trim().toLowerCase())
    ), []);
    const liquidNameSet = useMemo(() => new Set(
      Object.keys(optionNotes.liquids || {}).map(name => name.trim().toLowerCase())
    ), []);
    const closureNameSet = useMemo(() => {
      const base = [
        ...Object.keys(optionNotes.closures || {}),
        'No Wax Seal',
        'Wax Sealed',
        'Wooden Closure',
      ];
      return new Set(base.map(name => name.trim().toLowerCase()));
    }, []);

    const detectStepRole = useCallback((step: any): StepRole => {
      if (!step) return 'unknown';
      const attrs: any[] = Array.isArray(step.attributes) ? step.attributes : [];
      if (!attrs.length) return 'unknown';

      const attrNames = attrs
        .map((a: any) => (a?.name || '').toString().trim().toLowerCase())
        .filter(Boolean);
      const options: any[] = attrs.flatMap((a: any) =>
        Array.isArray(a?.options) ? a.options : []
      );
      const optionNames = options
        .map(o => (o?.name || '').toString().trim().toLowerCase())
        .filter(Boolean);
      const optionCodes = options
        .map(o => (o?.code || '').toString().trim().toLowerCase())
        .filter(Boolean);

      if (optionCodes.some(code => code.includes('_label_')) ||
          attrNames.some(name => name.includes('label') || name.includes('design'))) {
        return 'label';
      }

      const closureKeywordHit = optionNames.some(name =>
        closureNameSet.has(name) || name.includes('wax') || name.includes('wood')
      ) || attrNames.some(name => name.includes('closure') || name.includes('wax') || name.includes('wood'));

      if (closureKeywordHit) {
        return 'closure';
      }

      if (optionNames.some(name => liquidNameSet.has(name) || name.includes('gin') || name.includes('liquid'))) {
        return 'liquid';
      }

      if (optionNames.some(name => bottleNameSet.has(name) || name.includes('bottle'))) {
        return 'bottle';
      }

      return 'unknown';
    }, [bottleNameSet, closureNameSet, liquidNameSet]);

    const stepByRole = useMemo(() => {
      const map: Record<Exclude<StepRole, 'unknown'>, any | null> = {
        bottle: null,
        liquid: null,
        closure: null,
        label: null,
      };

      for (const step of steps) {
        const role = detectStepRole(step);
        if (role !== 'unknown' && map[role] == null) {
          map[role] = step;
        }
      }

      return map;
    }, [steps, detectStepRole]);

    const bottleStep = stepByRole.bottle;
    const liquidStep = stepByRole.liquid;
    const closureStep = stepByRole.closure;
    const labelStep = stepByRole.label ?? (steps.length ? steps[steps.length - 1] : null);

    const bottleStepId = bottleStep?.id ?? null;
    const liquidStepId = liquidStep?.id ?? null;
    const closureStepId = closureStep?.id ?? null;
    const labelStepId = labelStep?.id ?? null;

    const findSelectedOption = (step: any | null) => {
      if (!step) return null;
      const attrs: any[] = Array.isArray(step.attributes) ? step.attributes : [];
      for (const attr of attrs) {
        const options: any[] = Array.isArray(attr?.options) ? attr.options : [];
        const hit = options.find((o: any) => !!o?.selected);
        if (hit) return hit;
      }
      return null;
    };

    const bottleSel = findSelectedOption(bottleStep);

    const resolvedBottle = useMemo(() => {
      if (bottleSel) {
        return {
          slug: DEFAULT_BOTTLE_SLUG,
          mini: toMini(bottleSel),
          option: bottleSel,
        };
      }
      return DEFAULT_BOTTLE;
    }, [bottleSel]);

    const fallbackOption = (step: any | null, preferEnabled = true) => {
      if (!step) return null;
      const attrs: any[] = Array.isArray(step.attributes) ? step.attributes : [];
      const attr = (preferEnabled ? attrs.find(a => !!a?.enabled) : null) || attrs[0] || null;
      const opts: any[] = Array.isArray(attr?.options) ? attr!.options : [];
      return opts[0] || null;
    };

    const pickFromStep = (step: any | null, role: StepRole) => {
      if (!step) return null;
      const selected = findSelectedOption(step);
      if (selected) return selected;

      const attrs: any[] = Array.isArray(step.attributes) ? step.attributes : [];
      const allOptions: any[] = attrs.flatMap((attr: any) =>
        Array.isArray(attr?.options) ? attr.options : []
      );

      if (role === 'label') {
        const noSel = allOptions.find(
          (o: any) => (o?.name || '').trim().toLowerCase() === 'no selection'
        );
        if (noSel) return noSel;
      }

      return fallbackOption(step, true);
    };

    const liquidSel  = pickFromStep(liquidStep, 'liquid');
    const closureSel = pickFromStep(closureStep, 'closure');
    const labelSel   = pickFromStep(labelStep, 'label');

    const bottleSlug = resolvedBottle.slug;
    const hasBottleStep = !!bottleStep;

    useEffect(() => {
      if (!bottleStep) return;
      if (slugFromOption(bottleSel) === DEFAULT_BOTTLE_SLUG) return;

      const attrs: any[] = Array.isArray(bottleStep.attributes) ? bottleStep.attributes : [];
      for (const attr of attrs) {
        const opts: any[] = Array.isArray(attr?.options) ? attr.options : [];
        const antica = opts.find((o: any) => slugFromOption(o) === DEFAULT_BOTTLE_SLUG);
        if (antica) {
          if (!antica.selected) selectOption(antica.id);
          break;
        }
      }
    }, [bottleStep, bottleSel, selectOption]);
    // Speed Change

    // --- UI navigation state (must be declared before effects that depend on them) ---
    // const [selectedGroupId, selectGroup] = useState<number | null>(null);
    // const [selectedStepId, selectStep] = useState<number | null>(null);
    // const [selectedAttributeId, selectAttribute] = useState<number | null>(null);

    const [selectedGroupId, selectGroup] = useState<number | null>(null);
    const [selectedStepId, selectStep] = useState<number | null>(null);
    const [selectedAttributeId, selectAttribute] = useState<number | null>(null);
    
    useEffect(() => {
      if (!groups || groups.length === 0) return;
      if (selectedGroupId !== null && selectedStepId !== null && selectedAttributeId !== null) return;

      const bottleGroup = groups.find(g => g.name === 'Build Your Bottle') || groups[0];
      const firstStep = bottleGroup.steps?.[0] || null;
      const attrs = (firstStep || bottleGroup)?.attributes || [];
      const firstEnabledAttr = attrs.find(a => a.enabled) || attrs[0];

      React.startTransition?.(() => {
        selectGroup(prev => (prev === null ? bottleGroup.id : prev));
        if (firstStep) selectStep(prev => (prev === null ? firstStep.id : prev));
        if (firstEnabledAttr) selectAttribute(prev => (prev === null ? firstEnabledAttr.id : prev));
      });
    }, [groups, selectedGroupId, selectedStepId, selectedAttributeId, selectGroup, selectStep, selectAttribute]);

    // Speed Change

    const selectedGroup = groups.find(group => group.id === selectedGroupId);
    const selectedStep = selectedGroup?.steps.find(step => step.id === selectedStepId) ?? null;

    const selectedStepRole = useMemo<StepRole>(() => {
      if (!selectedStep) return 'unknown';
      const id = selectedStep.id;
      if (id === bottleStepId) return 'bottle';
      if (id === liquidStepId) return 'liquid';
      if (id === closureStepId) return 'closure';
      if (id === labelStepId) return 'label';
      return 'unknown';
    }, [selectedStep, bottleStepId, liquidStepId, closureStepId, labelStepId]);

    const notesCategory = useMemo(() => {
      if (selectedStepRole === 'bottle') return 'bottles' as const;
      if (selectedStepRole === 'liquid') return 'liquids' as const;
      if (selectedStepRole === 'closure') return 'closures' as const;
      return null;
    }, [selectedStepRole]);

    const notesTitle = useMemo(() => {
      switch (notesCategory) {
        case 'bottles':
          return 'Bottle Style';
        case 'liquids':
          return 'Tasting Notes';
        case 'closures':
          return 'Closure';
        default:
          return 'Notes';
      }
    }, [notesCategory]);

    // Ensure the single label attribute follows the selected bottle
    // BUT only when we are on the Label/Design step. Otherwise keep labels hidden via "No Selection".
    useEffect(() => {
      const step = labelStep;
      if (!step) return;

      const attrs: any[] = Array.isArray(step.attributes) ? step.attributes : [];
      const attr = attrs[0] || null; // single attribute holding all label options
      if (!attr) return;

      const opts: any[] = Array.isArray((attr as any).options) ? (attr as any).options : [];
      if (!opts.length) return;

      const noSel = opts.find(o => (o?.name || '').trim().toLowerCase() === 'no selection') || null;

      const isLabelStep =
        (selectedStep?.id != null && selectedStep?.id === labelStepId) ||
        selectedStepRole === 'label';

      // If we're NOT on the label step, force "No Selection" so labels stay hidden
      if (!isLabelStep) {
        const active = opts.find(o => !!o?.selected);
        if (active && noSel && active.id !== noSel.id) {
          selectOption(noSel.id);
        }
        return;
      }

      // We ARE on the label step → map bottle -> specific label option by code suffix
      const bottleKey = bottleSlug;

      const match = !!bottleKey
        ? opts.find(o => {
            const code = typeof o?.code === 'string' ? o.code.toLowerCase() : '';
            const nameSlug = slugify(o?.name || '');
            if (code.endsWith(`_${bottleKey}`)) return true;
            if (code.includes(`${bottleKey}_label`)) return true;
            return nameSlug === bottleKey;
          })
        : null;

      if (match && !match.selected) {
        selectOption(match.id);
        return;
      }

      const firstDesignOption = opts.find(o => o && o.id !== (noSel?.id ?? null)) || null;
      if (firstDesignOption && !firstDesignOption.selected) {
        selectOption(firstDesignOption.id);
        return;
      }
      if (!match && !firstDesignOption && noSel && !noSel.selected) {
        selectOption(noSel.id);
      }
    }, [labelStep, labelStepId, selectedStepId, selectedStep?.id, selectedStepRole, bottleSlug, selectOption]);

    // Keep "No Selection" visible in minis
    const miniBottle  = resolvedBottle.mini;
    const miniLiquid  = toMini(liquidSel);
    const miniClosure = toMini(closureSel);
    const miniLabel   = toMini(labelSel);

    const selections = useMemo(() => ({
      bottleSel,
      liquidSel,
      closureSel,
      labelSel,
      bottle: miniBottle,
      liquid: miniLiquid,
      closure: miniClosure,
      label: miniLabel,
    } as const), [
      bottleSel,
      liquidSel,
      closureSel,
      labelSel,
      miniBottle,
      miniLiquid,
      miniClosure,
      miniLabel,
    ]);

    const labelSelBySide = useMemo<LabelSelectionsBySide>(() => {
      const front = buildLabelSelectionDetail((labelDesigns as any)?.front);
      const back = buildLabelSelectionDetail((labelDesigns as any)?.back);
      return { front, back };
    }, [labelDesigns]);

    // Speed Change
    
    // Key that only changes when meaningful order fields change, closure id excluded to avoid transient updates during attribute switch
    // const orderKey = [
    //   product?.sku ?? '',
    //   String(price ?? ''),
    //   selections.bottle?.id ?? 0,
    //   selections.liquid?.id ?? 0,
    //   /* closure id excluded to avoid transient updates during attribute switch */
    //   selections.label?.id ?? 0,
    // ].join('|');
    // useEffect(() => {
    //   setFromSelections({
    //     selections,
    //     sku: product?.sku ?? null,
    //     price,
    //   });
    // }, [orderKey, setFromSelections, selections, product?.sku, price]);

    const orderKey = [
      product?.sku ?? '',
      String(price ?? ''),
      selections.bottle?.id ?? 0,
      selections.liquid?.id ?? 0,
      /* closure id excluded to avoid transient updates during attribute switch */
      selections.label?.id ?? 0,
    ].join('|');
    // Debounce cross-window/store update to avoid bursts during initialisation
    const debouncedSetFromSelectionsTimer = useRef<number | null>(null);
    // We intentionally key this effect only on `orderKey` to debounce cross-window/store updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
      // clear any pending run
      if (debouncedSetFromSelectionsTimer.current) {
        clearTimeout(debouncedSetFromSelectionsTimer.current);
        debouncedSetFromSelectionsTimer.current = null;
      }

      // schedule the update; adjust delay to taste (0 = microtask, 100–200ms = debounce)
      debouncedSetFromSelectionsTimer.current = window.setTimeout(() => {
        setFromSelections({
          selections,
          sku: product?.sku ?? null,
          price,
        });
      }, 150);

      // cleanup on dep change/unmount
      return () => {
        if (debouncedSetFromSelectionsTimer.current) {
          clearTimeout(debouncedSetFromSelectionsTimer.current);
          debouncedSetFromSelectionsTimer.current = null;
        }
      };
      // Only re-run when the meaningful order fingerprint changes
    }, [orderKey]);

    // Speed Change

    const hasBottleSelection = !!miniBottle && miniBottle.name !== 'No Selection';
    const hasLiquidSelection = !!miniLiquid && miniLiquid.name !== 'No Selection';
    const hasClosureSelection = !!miniClosure && miniClosure.name !== 'No Selection';

    const productObject = useMemo(() => {
      const slug = bottleSlug || slugFromOption(selections.bottleSel);
      const frontMeshId = slug ? getMeshIDbyName(`${slug}_label_front`) : null;
      const backMeshId  = slug ? getMeshIDbyName(`${slug}_label_back`)  : null;

      const valid =
        hasLiquidSelection &&
        hasClosureSelection &&
        (!hasBottleStep || hasBottleSelection);

      return {
        sku: product?.sku ?? null,
        price,
        bottleSlug: slug,
        selections: {
          bottle: selections.bottle,
          liquid: selections.liquid,
          closure: selections.closure,
          label: selections.label,
          labelSel: labelSelBySide,
          // carry VistaCreate design IDs for edit flow
          frontDesignId: (labelDesigns as any)?.front?.id ?? null,
          backDesignId:  (labelDesigns as any)?.back?.id  ?? null,
        },
        mesh: { frontMeshId, backMeshId },
        labels: labelSelBySide,
        labelSel: labelSelBySide,
        valid,
      } as const;
    }, [
      price,
      product?.sku,
      selections,
      getMeshIDbyName,
      labelDesigns,
      bottleSlug,
      labelSelBySide,
      hasBottleSelection,
      hasBottleStep,
      hasClosureSelection,
      hasLiquidSelection,
    ]);

    const findLabelArea = useCallback(
      (side: 'front' | 'back') => {
        const areas = Array.isArray(product?.areas) ? product!.areas : [];
        const slug = (productObject.bottleSlug || bottleSlug || '').toLowerCase();
        const lowerSide = side.toLowerCase();
        const exact = slug
          ? areas.find(a => (a?.name || '').toLowerCase() === `${slug}_label_${lowerSide}`)
          : null;
        if (exact) return exact;
        return areas.find(a => (a?.name || '').toLowerCase().endsWith(`_label_${lowerSide}`)) || null;
      },
      [product, productObject.bottleSlug, bottleSlug]
    );

    // Speed Change

    // const visibleAreas = useMemo(() => {
    //   const areas = product?.areas ?? [];
    //   if (isSceneLoading || !areas.length || typeof isAreaVisible !== 'function') return [];

    //   return areas.filter(a => {
    //     try { return isAreaVisible(a.id); } catch { return false; }
    //   });
    // }, [isSceneLoading, product?.areas, isAreaVisible]);

    const areas = product?.areas ?? [];
    const areaKey = areas.map(a => a.id).join(',');

    const visibleAreas = useMemo(() => {
      if (isSceneLoading || !areas.length || typeof isAreaVisible !== 'function') return [];
      return areas.filter(a => {
        try { return isAreaVisible(a.id); } catch { return false; }
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [areaKey, isSceneLoading, isAreaVisible]);

    // Speed Change

    const labelAreas = useMemo(() => {
      const byName = (needle: string) =>
        visibleAreas.find(a => (a.name || '').toLowerCase().includes(needle)) || null;

      const front = byName('front');
      const back = byName('back');

      return { front, back } as const;
    }, [visibleAreas]);

    const activeItems = useMemo(
      () => (Array.isArray(items) ? items.filter((it: any) => !it?.deleted) : []),
      [items]
    );

    const resolveItemAreaId = useCallback((item: any): number | null => {
      if (!item || typeof item !== 'object') return null;

      const toNumeric = (value: any): number | null => {
        if (value == null) return null;

        if (typeof value === 'string') {
          const parsed = Number.parseInt(value, 10);
          return Number.isFinite(parsed) ? parsed : null;
        }

        if (typeof value === 'number') {
          return Number.isFinite(value) ? value : null;
        }

        if (Array.isArray(value)) {
          for (const entry of value) {
            const resolved = toNumeric(entry);
            if (resolved != null) return resolved;
          }
          return null;
        }

        if (typeof value === 'object') {
          return toNumeric([
            (value as any).id,
            (value as any).ID,
            (value as any).areaId,
            (value as any).areaID,
            (value as any).sideId,
            (value as any).sideID,
          ]);
        }

        return null;
      };

      return toNumeric([
        item.areaId,
        item.areaID,
        item.sideId,
        item.sideID,
        item.side,
        item.area,
        item.sides,
        item.sideIds,
        item.sideIDs,
        item.areaIds,
        item.areaIDs,
      ]);
    }, []);

    const frontLabelAreaId = useMemo(
      () => findLabelArea('front')?.id ?? null,
      [findLabelArea]
    );

    // const backLabelAreaId = useMemo(
    //   () => findLabelArea('back')?.id ?? null,
    //   [findLabelArea]
    // );

    // // Checks both front and back label areas (if defined) have at least one active item assigned
    // const labelsPopulated = useMemo(() => {
    //   const frontReady =
    //     frontLabelAreaId == null ||
    //     activeItems.some(item => resolveItemAreaId(item) === frontLabelAreaId);
    //   const backReady =
    //     backLabelAreaId == null ||
    //     activeItems.some(item => resolveItemAreaId(item) === backLabelAreaId);
    //   return frontReady && backReady;
    // }, [activeItems, frontLabelAreaId, backLabelAreaId, resolveItemAreaId]);
    
    // Checks front label only
    const labelsPopulated = useMemo(() => {
      const frontReady =
        frontLabelAreaId == null ||
        activeItems.some(item => resolveItemAreaId(item) === frontLabelAreaId);
      
      return frontReady;
    }, [activeItems, frontLabelAreaId, resolveItemAreaId]);

    const labelsPopulatedRef = useRef(labelsPopulated);
    useEffect(() => {
      labelsPopulatedRef.current = labelsPopulated;
    }, [labelsPopulated]);
    const waitForLabelsPopulated = useCallback(
      async (timeoutMs = 10000, pollMs = 120) => {
        if (labelsPopulatedRef.current) return true;
        return new Promise<boolean>((resolve) => {
          const start = Date.now();
          const tick = () => {
            if (labelsPopulatedRef.current) {
              resolve(true);
              return;
            }
            if (Date.now() - start >= timeoutMs) {
              resolve(false);
              return;
            }
            setTimeout(tick, pollMs);
          };
          tick();
        });
      },
      []
    );
    const markDomLabelReady = useCallback((side: 'front' | 'back') => {
      if (typeof document === 'undefined') return;
      const attr = side === 'front' ? 'data-front-label-ready' : 'data-back-label-ready';
      document.body?.setAttribute(attr, 'true');
    }, []);

    // Invisible warning helper (logs and stores a message for later UX surfacing)
    const setWarning = (msg: string) => {
      const el = document.getElementById('config-warning');
      if (el) {
        el.textContent = msg;
        el.setAttribute('data-warning', 'true');
      }
      console.warn('[Configurator warning]', msg);
    };

    const canDesign =
      hasLiquidSelection &&
      hasClosureSelection &&
      (!hasBottleStep || hasBottleSelection);

    const missingSelections = useCallback(() => {
      const missing: string[] = [];
      if (hasBottleStep && !hasBottleSelection) missing.push('bottle');
      if (!hasLiquidSelection) missing.push('liquid');
      if (!hasClosureSelection) missing.push('closure');
      return missing;
    }, [hasBottleStep, hasBottleSelection, hasLiquidSelection, hasClosureSelection]);

    const warnMissingSelections = useCallback((suffix = '.') => {
      const missing = missingSelections();
      if (!missing.length) return;
      const list = formatList(missing);
      const message = suffix ? `Please select ${list}${suffix}` : `Please select ${list}.`;
      setWarning(message.replace(/\.{2,}$/, '.'));
    }, [missingSelections]);

    // Initialize group/step/attribute once groups are available
    useEffect(() => {
      if (!groups || groups.length === 0) return;
      if (selectedGroupId !== null && selectedStepId !== null && selectedAttributeId !== null) return;

      const bottleGroup = groups.find(g => g.name === 'Build Your Bottle') || groups[0];
      selectGroup((prev: number | null) => (prev === null ? bottleGroup.id : prev));

      const firstStep = bottleGroup.steps?.[0] || null;
      if (firstStep) {
        selectStep((prev: number | null) => (prev === null ? firstStep.id : prev));
      }

      const attrs = (firstStep || bottleGroup)?.attributes || [];
      const firstEnabledAttr = attrs.find(a => a.enabled) || attrs[0];
      if (firstEnabledAttr) {
        selectAttribute((prev: number | null) => (prev === null ? firstEnabledAttr.id : prev));
      }
    }, [groups, selectedGroupId, selectedStepId, selectedAttributeId]);


    // (Optional debug) Log selected group/step
    const attributes = useMemo(() => (selectedStep || selectedGroup)?.attributes ?? [], [selectedGroup, selectedStep]);
    const selectedAttribute = attributes.find(attribute => attribute.id === selectedAttributeId);

    // When step changes, ensure an attribute is selected
    useEffect(() => {
      if (!selectedStep && !selectedGroup) return;
      const attrs = (selectedStep || selectedGroup)?.attributes || [];
      if (!attrs.length) return;
      const firstEnabledAttr = attrs.find(a => a.enabled) || attrs[0];
      if (firstEnabledAttr && selectedAttributeId == null) {
        selectAttribute(firstEnabledAttr.id);
      }
    }, [selectedStep, selectedGroup, selectedAttributeId, attributes]);
    
    useEffect(() => {
      const onMsg = async (e: MessageEvent) => {
        // console.log("Received message", e);
        const origin = e.origin || '';
        const originAllowed = (() => {
          if (!origin) return false;
          if (allowedParentOrigins.length) {
            return allowedParentOrigins.includes(origin);
          }
          if (typeof window === 'undefined') return false;
          return origin === window.location.origin || origin === 'null';
        })();

        if (!originAllowed) {
          console.warn('[Configurator] Ignoring message from untrusted origin', origin);
          return;
        }

        const payload = e.data;
        if (!payload || typeof payload !== 'object') return;

        if (payload.customMessageType === 'uploadDesign') {
          console.log("uploadDesign payload.message", payload.message);

          const {
            designExport,
            designSide,
            designSource: incomingDesignSource,
            designSourceId: incomingDesignSourceId,
          } = payload.message || {};
          const normalizedDesignExport =
            incomingDesignSource || incomingDesignSourceId
              ? {
                  ...(designExport || {}),
                  ...(incomingDesignSource ? { designSource: incomingDesignSource } : {}),
                  ...(incomingDesignSourceId ? { designSourceId: incomingDesignSourceId } : {}),
                }
              : designExport;
          const parentOrder = payload.message?.order;
          if (designSide) {
            // Persist to zustand so UI flips to "Edit [side] label" and save gating can use it
            setFromUploadDesign({
              order: parentOrder,
              designSide,
              designExport: normalizedDesignExport,
            });
          }

          if (!designSide ) return;
          if (designSide !== 'front' && designSide !== 'back') {
            console.warn('[Configurator] Unsupported design side provided', designSide);
            return;
          }

          const buildLabelMessagePayload = () => {
            const sourceOverrideRaw = toTrimmedString(incomingDesignSource);
            const designSourceOverride = sourceOverrideRaw
              ? normalizeDesignSource(sourceOverrideRaw)
              : undefined;
            const designSourceIdOverride = toTrimmedString(incomingDesignSourceId) ?? undefined;

            const detail =
              buildLabelSelectionDetail(normalizedDesignExport, {
                fallbackSource: designSourceOverride ?? 'upload',
                overrides: {
                  designSource: designSourceOverride,
                  designSourceId: designSourceIdOverride ?? null,
                },
              }) ??
              {
                s3Url: null,
                zakekeMediaUrl: null,
                zakekePreviewUrl: null,
                designSource: designSourceOverride ?? 'upload',
                designSourceId: designSourceIdOverride ?? null,
              };

            const labelsBase = productObject.labelSel ?? { front: null, back: null };
            const mergedLabelSel: LabelSelectionsBySide = {
              ...labelsBase,
              [designSide]: detail,
            };

            return { mergedLabelSel };
          };

          const targetArea = findLabelArea(designSide);
          console.log("targetArea", targetArea);
          if (!targetArea) {
            console.warn('No area found', { designSide, bottleSlug: productObject?.bottleSlug ?? null });
            return;
          }

          if(designSide === "front") {
            const frontS3Url =
              toTrimmedString(normalizedDesignExport?.s3url) ??
              toTrimmedString(normalizedDesignExport?.s3Url) ??
              toTrimmedString(normalizedDesignExport?.url);
            if (!frontS3Url) {
              console.warn('No front label URL provided; cannot create image.');
              return;
            }
            const frontImage = await createImageFromUrl(frontS3Url);
            console.log("frontImage", frontImage);
            // const frontImage = await createImageFromUrl("https://spirits-studio.s3.eu-west-2.amazonaws.com/public/Front+Label+for+the+Polo+Bottle+inc+Bleed.jpg");
            // const frontMeshId = getMeshIDbyName(`${productObject?.selections?.bottle?.name.toLowerCase()}_label_front`);
            // console.log("frontMeshId", frontMeshId);

            const frontAreaId = targetArea.id;
            console.log("frontAreaId", frontAreaId);

            console.log("areas", areas)

            
            if (frontImage?.imageID && frontAreaId) {
              await addItemImage(frontImage.imageID, frontAreaId);
              console.log("addItemImage", addItemImage)

              const populated = await waitForLabelsPopulated();
              if (!populated) {
                console.warn('Timed out waiting for front label to populate.');
                return;
              }

              console.log("populated", populated);
              markDomLabelReady('front');

              const { mergedLabelSel } = buildLabelMessagePayload();
              window.parent.postMessage({
                customMessageType: 'labelAdded',
                message: {
                  'order': {
                    'bottle': productObject.selections.bottle,
                    'liquid': productObject.selections.liquid,
                    'closure': productObject.selections.closure,
                    'label': productObject.selections.label,
                  },
                  'labels': mergedLabelSel,
                  'labelSel': mergedLabelSel,
                  'designSide': designSide,
                  'designExport': normalizedDesignExport,
                  'productSku': product?.sku ?? null,
                }
              }, '*');
            } else {
              console.warn("Missing info to add front label", { frontImage, frontAreaId });
            }
          
          } else if(designSide === "back") {
            const backS3Url =
              toTrimmedString(normalizedDesignExport?.s3url) ??
              toTrimmedString(normalizedDesignExport?.s3Url) ??
              toTrimmedString(normalizedDesignExport?.url);
            if (!backS3Url) {
              console.warn('No back label URL provided; cannot create image.');
              return;
            }
            const backImage = await createImageFromUrl(backS3Url);
            // const backImage = await createImageFromUrl("https://spirits-studio.s3.eu-west-2.amazonaws.com/public/Front+Label+for+the+Polo+Bottle+inc+Bleed.jpg");
  
            // const backMeshId = getMeshIDbyName(`${productObject?.selections?.bottle?.name.toLowerCase()}_label_back`);
            // console.log("backMeshId", backMeshId);
  
            const backAreaId = targetArea.id;
  
            // console.log("backAreaId", backAreaId);
  
            if (backImage?.imageID && backAreaId) {
              await addItemImage(backImage.imageID, backAreaId);

              // Turn on the front and back label labelsPopulated check
              const populated = await waitForLabelsPopulated();
              if (!populated) {
                console.warn('Timed out waiting for back label to populate.');
                return;
              }
              markDomLabelReady('back');

              const { mergedLabelSel } = buildLabelMessagePayload();
              window.parent.postMessage({
                customMessageType: 'labelAdded',
                message: {
                  'order': {
                    'bottle': productObject.selections.bottle,
                    'liquid': productObject.selections.liquid,
                    'closure': productObject.selections.closure,
                    'label': productObject.selections.label,
                  },
                  'labels': mergedLabelSel,
                  'labelSel': mergedLabelSel,
                  'designSide': designSide,
                  'designExport': normalizedDesignExport,
                  'productSku': product?.sku ?? null,
                }
              }, '*');
            }
          }
        }
      };
      window.addEventListener('message', onMsg);
      return () => window.removeEventListener('message', onMsg);
    }, [allowedParentOrigins, groups, createImageFromUrl, addItemImage, items, productObject, product?.sku, setFromUploadDesign, findLabelArea, waitForLabelsPopulated, markDomLabelReady]);



    useEffect(() => {
        if (!selectedAttribute && attributes.length > 0) {
            const firstEnabledAttribute = attributes.find(attr => attr.enabled);
            if (firstEnabledAttribute) {
                selectAttribute(firstEnabledAttribute.id);
            }
        }
    }, [selectedAttribute, attributes]);

    
    // Guard camera updates to avoid infinite loops; normalise to string and use setCameraByName
    const lastCameraLocationIdRef = useRef<string | null>(null);
    useEffect(() => {
      const raw = (selectedGroup as any)?.cameraLocationId ?? null;
      const cameraKey: string | null = raw == null ? null : String(raw);

      if (cameraKey && lastCameraLocationIdRef.current !== cameraKey) {
        lastCameraLocationIdRef.current = cameraKey;
        try {
          // set by name only; avoids numeric vs string overload/type issues
          setCameraByName(cameraKey as unknown as string);
        } catch (e) {
          console.warn('[Configurator] Failed to set camera by name', cameraKey, e);
        }
      }
    }, [selectedGroupId, selectedGroup?.cameraLocationId, setCameraByName]);

    // // === Camera animation: refs & helpers (top-level inside component) ===
    const camAbort = useRef<AbortController | null>(null);
    const lastCamRef = useRef<string | null>(null);
    const isAnimatingCam = useRef(false);
    const prevTourKeyRef = useRef<string | null>(null);

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
        lastCamRef.current = name;
      } catch {}
    }, [setCameraByName]);

    const runCameraTour = useCallback(async (frames: string[], final: string, perFrameMs = 600) => {
      // prevent concurrent tours
      if (isAnimatingCam.current) return;
      isAnimatingCam.current = true;

      camAbort.current?.abort();
      const ctrl = new AbortController();
      camAbort.current = ctrl;

      try {
        // ensure visible motion if we're already on the final cam
        const seq = [...frames];
        if (lastCamRef.current && lastCamRef.current === final) {
          const alt = frames.find(f => f !== final);
          if (alt) seq.unshift(alt);
        }

        for (const f of seq) {
          if (ctrl.signal.aborted) return;
          await moveCamera(f);
          await new Promise(r => setTimeout(r, perFrameMs));
        }
        if (!ctrl.signal.aborted) await moveCamera(final);
      } finally {
        if (camAbort.current === ctrl) camAbort.current = null;
        isAnimatingCam.current = false;
      }
    }, [moveCamera]);

    // Fire tour on step / bottle change, but debounce identical requests
    useEffect(() => {
      if (!selectedStep) return;

      const stepKey: 'bottle' | 'liquid' | 'closure' | 'label' =
        selectedStepRole === 'bottle' ? 'bottle' :
        selectedStepRole === 'liquid' ? 'liquid' :
        selectedStepRole === 'closure' ? 'closure' : 'label';

      // derive bottle key from current bottle selection (e.g. "Antica" -> "antica")
      const bottleKey =
        productObject.bottleSlug ||
        bottleSlug ||
        slugify(selections.bottle?.name || '');

      // if no bottle yet, skip anim
      if (!bottleKey) return;

      // build dynamic camera names based on your convention
      const cams: Record<'full_front'|'full_side'|'closure'|'label_front'|'label_back', string> = {
        full_front: `${bottleKey}_full_front`,
        full_side: `${bottleKey}_full_side`,
        closure: `${bottleKey}_closure`,
        label_front: `${bottleKey}_label_front`,
        label_back: `${bottleKey}_label_back`,
      };

      // choose keyframe path for a short orbit feel per step
      let frames: string[] = [];
      let final: string = cams.full_front;

      if (stepKey === 'bottle') {
        frames = ['wide_high_back'];
        final = cams.full_front;
      } else if (stepKey === 'liquid') {
        frames = ['wide_low_front'];
        final = cams.full_front;
      } else if (stepKey === 'closure') {
        frames = ['wide_high_front', 'wide_high_back'];
        final = cams.closure;
      } else if (stepKey === 'label') {
        frames = ['wide_high_front'];
        const preferFront = !!labelAreas.front || !labelAreas.back;
        final = preferFront ? cams.label_front : cams.label_back;
      }

      const tourKey = `${stepKey}|${bottleKey}|${final}`;
      if (!isSceneLoading && prevTourKeyRef.current === tourKey) {
        return; // identical request, skip to avoid jitter
      }
      prevTourKeyRef.current = tourKey;

      (async () => {
        await waitSceneIdle(1500, 60); // wait for model/meshes swap to settle
        await runCameraTour(frames, final, 1000); // adjust per-frame ms as desired
      })();

      return () => camAbort.current?.abort();
    }, [
      selectedStep,
      selectedStep?.id,
      selectedStepRole,
      productObject.bottleSlug,
      bottleSlug,
      labelAreas.front,
      labelAreas.front?.id,
      labelAreas.back,
      labelAreas.back?.id,
      isSceneLoading,
      runCameraTour,
      waitSceneIdle,
      selections.bottle?.name
    ]);

    // --- Helper: find an option by exact name across ALL attributes in the current step ---
    const selectedOptionForNotes = useMemo(() => {
      if (!selectedAttribute) return null;
      const opts = Array.isArray((selectedAttribute as any).options) ? (selectedAttribute as any).options : [];
      return opts.find((opt: any) => opt?.selected && opt?.name !== 'No Selection') || null;
    }, [selectedAttribute]);

    const onLabelStep = selectedStepRole === 'label';

    const buildSelectionsMessage = useCallback(() => ({
      order: {
        bottle: productObject.selections.bottle,
        liquid: productObject.selections.liquid,
        closure: productObject.selections.closure,
        label: productObject.selections.label,
      },
      labels: productObject.labels,
      labelSel: productObject.labelSel,
      productSku: product?.sku ?? null,
      price,
    }), [productObject, product?.sku, price]);

    const postSelectionsToParent = useCallback((customMessageType: string) => {
      const message = buildSelectionsMessage();
      window.parent.postMessage({ customMessageType, message }, '*');
      console.log("Parent Message posted from Zakeke", { customMessageType, message });
    }, [buildSelectionsMessage]);

    const handleDesignWithAi = useCallback(() => {
      if (!canDesign) {
        warnMissingSelections(' before designing with AI.');
        return;
      }
      postSelectionsToParent('designWithAi');
    }, [canDesign, postSelectionsToParent, warnMissingSelections]);

    const handleUploadLabels = useCallback(() => {
      if (!canDesign) {
        warnMissingSelections(' before uploading labels.');
        return;
      }
      postSelectionsToParent('uploadLabels');
    }, [canDesign, postSelectionsToParent, warnMissingSelections]);

    const handleEditLabel = useCallback(() => {
      if (!canDesign) {
        warnMissingSelections(' before uploading labels.');
        return;
      }
      postSelectionsToParent('editLabels');
    }, [canDesign, postSelectionsToParent, warnMissingSelections]);


    // Step validation helpers
    const isBottleStep  = selectedStepRole === 'bottle';
    const isLiquidStep  = selectedStepRole === 'liquid';
    const isClosureStep = selectedStepRole === 'closure';
    const hasValidSelection = !!(selectedAttribute?.options?.some(o => o.selected && o.name !== 'No Selection'));

    // const getOptionIdByName = (name: string) => {
    //   const needle = (name || '').trim().toLowerCase();
    //   const hit = closureOptions.find(o => (o.name || '').trim().toLowerCase() === needle);
    //   return hit?.id ?? null;
    // };
    

    const isConfiguratorLoading = isSceneLoading || !Array.isArray(groups) || !groups.length;

    const moveCameraToFullFront = useCallback(async () => {
      if (!Array.isArray(cameras) || !cameras.length) return;

      const slugCandidate =
        productObject.bottleSlug ||
        bottleSlug ||
        slugify(selections.bottle?.name || '');

      const normalizedSlug = (slugCandidate || '').trim().toLowerCase();
      if (!normalizedSlug) return;

      const hyphenSlug = normalizedSlug.replace(/[_\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      const underscoreSlug = normalizedSlug.replace(/[-\s]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

      const candidateNames = Array.from(new Set(
        [
          hyphenSlug && `${hyphenSlug}-full-front`,
          hyphenSlug && `${hyphenSlug}_full_front`,
          underscoreSlug && `${underscoreSlug}-full-front`,
          underscoreSlug && `${underscoreSlug}_full_front`,
          normalizedSlug && `${normalizedSlug}-full-front`,
          normalizedSlug && `${normalizedSlug}_full_front`,
        ].filter(Boolean) as string[]
      ));

      const namedCameras = cameras
        .map((cam: any) => (typeof cam?.name === 'string' ? cam.name : ''))
        .filter(Boolean)
        .map(name => ({ original: name, normalized: name.toLowerCase() }));

      if (!namedCameras.length) return;

      const explicitMatch = namedCameras.find(entry =>
        candidateNames.some(candidate => candidate.toLowerCase() === entry.normalized)
      );

      const fallbackMatch = namedCameras.find(entry =>
        /full[-_]?front$/i.test(entry.normalized)
      );

      const targetCamera = (explicitMatch ?? fallbackMatch)?.original;
      if (!targetCamera) return;

      try {
        setCameraByName(targetCamera, false, true);
        await sleep(CAMERA_PREVIEW_SETTLE_MS);
      } catch (err) {
        console.warn('[Configurator] Failed to move camera before Add to Cart', targetCamera, err);
      }
    }, [cameras, productObject.bottleSlug, bottleSlug, selections.bottle?.name, setCameraByName]);

    const handleAddToCart = async () => {
    try {
        await moveCameraToFullFront();
        await addToCart(
            {},
            async (data) => {
                window.parent.postMessage({
                    customMessageType: "AddToCart",
                    message: {
                        preview: data.preview,
                        quantity: data.quantity,
                        compositionId: data.composition,
                        zakekeAttributes: data.attributes,
                        product_id: product?.sku || null,
                        bottle: productObject.selections.bottle,
                        liquid: productObject.selections.liquid,
                        closure: productObject.selections.closure,
                        label: productObject.selections.label,
                        labelSel: productObject.labelSel,
                        labels: productObject.labels,
                    }
                }, "*");

                return data;
            },
            false 
        );
    } catch (error) {
        console.error('Error during addToCart:', error);
    }
};

    if (isConfiguratorLoading)
        return <LoadingSpinner />;

    const showAddToCartButton = productObject.valid && labelsPopulated;

    return (
      <>
        {/* <RotateNotice>Please rotate your device to landscape for the best experience.</RotateNotice> */}
        <ConfigWarning />
        <LayoutWrapper>
        <ContentWrapper>
          <Container>
            {/* Step Navigation */}
            {selectedGroup && selectedGroup.steps.length > 0 && selectedStep && (
              <StepNav
                title={selectedStep.name}
                stepIndex={selectedGroup.steps.findIndex(s => s.id === selectedStep.id)}
                totalSteps={selectedGroup.steps.length}
                onPrev={() => {
                  const i = selectedGroup.steps.findIndex(s => s.id === selectedStep.id);
                  if (i > 0) selectStep(selectedGroup.steps[i - 1].id);
                }}
                onNext={() => {
                  const i = selectedGroup.steps.findIndex(s => s.id === selectedStep.id);
                  if (i < selectedGroup.steps.length - 1) {
                    if ((isBottleStep || isLiquidStep || isClosureStep) && !hasValidSelection) {
                      const which = isBottleStep ? 'bottle' : isLiquidStep ? 'liquid' : 'closure';
                      setWarning(`Please select a ${which} option (not "No Selection") to continue.`);
                      return;
                    }
                    const nextStep = selectedGroup.steps[i + 1];
                    const isLabelish = /label|design/i.test(nextStep?.name || '');
                    if (isLabelish && !canDesign) {
                      warnMissingSelections(' (not "No Selection") before designing labels.');
                      return;
                    }
                    selectStep(nextStep.id);
                  }
                }}
                disablePrev={selectedGroup.steps.findIndex(s => s.id === selectedStep.id) === 0}
                disableNext={
                  selectedGroup.steps.findIndex(s => s.id === selectedStep.id) === selectedGroup.steps.length - 1 ||
                  ((isBottleStep || isLiquidStep || isClosureStep) && !hasValidSelection)
                }
              />
            )}

            {/* Options */}
            {!onLabelStep && (
              <OptionsWrap>
                {selectedAttribute?.options
                  .filter(() => true)
                  .map(option => (
                    option.name !== "No Selection" && (
                      <OptionListItem
                        key={option.id}
                        onClick={() => selectOption(option.id)}
                        $selected={option.selected}
                        $width="200px"
                        tabIndex={0}
                      >
                        <OptionText>
                          <OptionTitle $selected={!!option.selected}>{option.name}</OptionTitle>
                          {selectedStepRole === 'liquid' && option.description && (
                            <OptionDescription>{option.description}</OptionDescription>
                          )}
                        </OptionText>
                      </OptionListItem>
                    )
                  ))}
              </OptionsWrap>
            )}

            {onLabelStep && (
              <ActionsCenter>
                {labelsPopulated ? (
                  <button
                      className="configurator-button"
                      disabled={!canDesign}
                      title={!canDesign ? 'Select liquid, and closure first' : undefined}
                      onClick={handleEditLabel}
                    >
                      Edit Your Label
                    </button>
                ) : (
                  <>
                    <button
                      className="configurator-button"
                      disabled={!canDesign}
                      title={!canDesign ? 'Select liquid, and closure first' : undefined}
                      onClick={handleDesignWithAi}
                    >
                      Design with AI
                    </button>
                    {/* <button
                      className="configurator-button"
                      disabled={!canDesign}
                      title={!canDesign ? 'Select liquid, and closure first' : undefined}
                      onClick={handleUploadLabels}
                    >
                      Upload Your Label
                    </button> */}
                  </>
                )}
              </ActionsCenter>
            )}

            {notesCategory && selectedOptionForNotes && (
              <NotesWrapper>
                <strong>{notesTitle}</strong>
                <p>
                  {(optionNotes as any)[notesCategory]?.[selectedOptionForNotes.name] || ''}
                </p>
              </NotesWrapper>
            )}
          </Container>
        </ContentWrapper>
        {/* <ViewportSpacer /> */}
        <CartBar
          price={price}
          showButton={showAddToCartButton}
          loading={isAddToCartLoading}
          onAdd={handleAddToCart}
          renderSpinner={<ClipLoader color="#FFFFFF" size={40} loading={true} />}
        />
        </LayoutWrapper>
      </>
    );
};

export default Selector;
