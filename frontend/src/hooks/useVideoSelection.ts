import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { MAX_BULK_VIDEOS } from '../utils/bulkVideoOrganization';

interface Options {
    scopeKey: string;
    modeScopeKey?: string;
    videos: readonly { id: string }[];
    enabled?: boolean;
    alwaysOn?: boolean;
    libraryReady?: boolean;
}

interface State { scope: string; modeScope: string; ids: Set<string>; active: boolean; locked: boolean; limitHits?: number }

export function useVideoSelection({ scopeKey, modeScopeKey = 'videos', videos, enabled = true, alwaysOn = false, libraryReady = true }: Options) {
    const { loginRequired, userRole, checkingAuth } = useAuth();
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const canWrite = enabled && !checkingAuth && (loginRequired === false || userRole === 'admin');
    const scope = JSON.stringify([scopeKey, canWrite, userRole]);
    const modeScope = JSON.stringify([modeScopeKey, canWrite, userRole]);
    const [state, setState] = useState<State>(() => ({ scope, modeScope, ids: new Set(), active: alwaysOn, locked: false }));
    const current = state.scope === scope;
    const active = canWrite && (alwaysOn || (state.modeScope === modeScope && state.active));
    const locked = active && current && state.locked;
    const available = useMemo(() => new Set(videos.map((video) => video.id)), [videos]);
    const selectedIds = useMemo(() => new Set(
        current && active ? [...state.ids].filter((id) => !libraryReady || available.has(id)) : [],
    ), [active, available, current, libraryReady, state.ids]);
    const lastLimit = useRef(0);
    useEffect(() => {
        if ((state.limitHits ?? 0) > lastLimit.current) {
            showSnackbar(t('bulkSelectionLimit'), 'warning');
            lastLimit.current = state.limitHits ?? 0;
        }
    }, [showSnackbar, state.limitHits, t]);

    const toggleMany = useCallback((ids: readonly string[]) => {
        if (!canWrite || locked) return;
        const page = [...new Set(ids)].filter((id) => available.has(id));
        if (!page.length) return;
        setState((previous) => {
            const next = previous.scope === scope
                ? new Set([...previous.ids].filter((id) => !libraryReady || available.has(id))) : new Set<string>();
            const remove = page.every((id) => next.has(id));
            for (const id of page) {
                if (remove) next.delete(id);
                else next.add(id);
            }
            if (next.size > MAX_BULK_VIDEOS) return { ...previous, limitHits: (previous.limitHits ?? 0) + 1 };
            return { scope, modeScope, ids: next, active: true, locked: false, limitHits: previous.limitHits };
        });
    }, [available, canWrite, libraryReady, locked, modeScope, scope]);

    const toggle = useCallback((id: string) => toggleMany([id]), [toggleMany]);
    const clear = useCallback(() => {
        if (!locked) setState((previous) => ({ scope, modeScope, ids: new Set(), active: true, locked: false, limitHits: previous.limitHits }));
    }, [locked, modeScope, scope]);
    const enter = useCallback(() => setState((previous) => ({ scope, modeScope, ids: new Set(), active: true, locked: false, limitHits: previous.limitHits })), [modeScope, scope]);
    const exit = useCallback(() => {
        if (!locked) setState((previous) => ({ scope, modeScope, ids: new Set(), active: alwaysOn, locked: false, limitHits: previous.limitHits }));
    }, [alwaysOn, locked, modeScope, scope]);
    const setLocked = useCallback((value: boolean) => {
        setState((previous) => previous.scope === scope ? { ...previous, locked: value } : previous);
    }, [scope]);

    // Commit scope/deletion resets as well as deriving them for this render.
    // Otherwise returning to an earlier filter could resurrect its old choices.
    if (!current || (libraryReady && state.ids.size !== selectedIds.size)) {
        setState({
            ...state, scope, modeScope, active,
            ids: current ? selectedIds : new Set(),
            locked: current ? state.locked : false,
        });
    }

    return { scope, canWrite, active, locked, selectedIds, toggle, togglePage: toggleMany, clear, enter, exit, setLocked };
}

export type VideoSelection = ReturnType<typeof useVideoSelection>;
