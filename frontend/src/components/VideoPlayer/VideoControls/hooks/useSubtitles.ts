import { useCallback, useEffect, useMemo, useState } from 'react';

interface Subtitle {
    language: string;
    filename: string;
    path: string;
}

interface LiveSubtitleInput {
    available: boolean;
    label: string;
    track: TextTrack | null;
}

interface UseSubtitlesProps {
    subtitles: Subtitle[];
    initialSubtitlesEnabled: boolean;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    onSubtitlesToggle?: (enabled: boolean) => void;
    // Optional dynamic "Live translation" subtitle track (design §9.5/§9.6).
    liveSubtitle?: LiveSubtitleInput;
    /**
     * When true, auto-select the live track as soon as it becomes available even
     * if file subtitles are globally off. Used by subtitle-only live translation
     * where translated speech is suppressed and captions are the only output.
     */
    forceLiveSubtitleOnAvailable?: boolean;
}

const MAX_ACTIVE_TRACKS = 2;

type FileSelectionState = {
    key: string;
    indices: number[];
};

type IndicesUpdate = number[] | ((indices: number[]) => number[]);

const getInitialFileIndices = (
    initialSubtitlesEnabled: boolean,
    subtitlesLength: number
): number[] => (initialSubtitlesEnabled && subtitlesLength > 0 ? [0] : []);

const setTextTrackMode = (track: TextTrack, mode: TextTrackMode) => {
    track.mode = mode;
};

export const useSubtitles = ({
    subtitles,
    initialSubtitlesEnabled,
    videoRef,
    onSubtitlesToggle,
    liveSubtitle,
    forceLiveSubtitleOnAvailable = false,
}: UseSubtitlesProps) => {
    const subtitleKey = useMemo(
        () => subtitles.map((subtitle) => subtitle.path).join('\0'),
        [subtitles]
    );
    const initialFileIndices = useMemo(
        () => getInitialFileIndices(initialSubtitlesEnabled, subtitles.length),
        [initialSubtitlesEnabled, subtitles.length]
    );
    const [fileSelectionState, setFileSelectionState] = useState<FileSelectionState>(() => ({
        key: subtitleKey,
        indices: initialFileIndices,
    }));
    const [liveSelectionOverride, setLiveSelectionOverride] = useState<{
        track: TextTrack | null;
        selected: boolean;
    } | null>(null);
    const [subtitleMenuAnchor, setSubtitleMenuAnchor] = useState<null | HTMLElement>(null);

    const liveAvailable = liveSubtitle?.available === true;
    const liveTrack = liveSubtitle?.track ?? null;
    const liveSubtitleSelected = liveAvailable
        ? liveSelectionOverride?.track === liveTrack
            ? liveSelectionOverride.selected
            : initialSubtitlesEnabled || forceLiveSubtitleOnAvailable
        : false;
    const rawSelectedSubtitleIndices =
        fileSelectionState.key === subtitleKey ? fileSelectionState.indices : initialFileIndices;
    const selectedSubtitleIndices = useMemo(
        () =>
            liveSubtitleSelected && rawSelectedSubtitleIndices.length >= MAX_ACTIVE_TRACKS
                ? rawSelectedSubtitleIndices.slice(1)
                : rawSelectedSubtitleIndices,
        [liveSubtitleSelected, rawSelectedSubtitleIndices]
    );
    const subtitlesEnabled = selectedSubtitleIndices.length > 0 || liveSubtitleSelected;

    const updateSelectedSubtitleIndices = (update: IndicesUpdate) => {
        setFileSelectionState((previous) => {
            const current =
                previous.key === subtitleKey ? previous.indices : initialFileIndices;
            const next = typeof update === 'function' ? update(current) : update;

            return {
                key: subtitleKey,
                indices: next,
            };
        });
    };

    // Apply showing/hidden modes by identity: file tracks occupy textTracks
    // [0..subtitles.length-1] (in array order); the dynamic live track — added via
    // addTextTrack — always sorts after them, so we address it by reference and
    // never by index. File-driven effects must not touch it.
    const applyTrackModes = useCallback((fileIndices: number[], liveSelected: boolean) => {
        const video = videoRef.current;
        if (video) {
            const tracks = video.textTracks;
            for (let i = 0; i < subtitles.length && i < tracks.length; i++) {
                setTextTrackMode(tracks[i], fileIndices.includes(i) ? 'showing' : 'hidden');
            }
        }
        if (liveTrack) {
            setTextTrackMode(liveTrack, liveSelected ? 'showing' : 'hidden');
        }
    }, [liveTrack, subtitles.length, videoRef]);

    useEffect(() => {
        applyTrackModes(selectedSubtitleIndices, liveSubtitleSelected);
    }, [applyTrackModes, liveSubtitleSelected, selectedSubtitleIndices]);

    const handleSubtitleClick = (event: React.MouseEvent<HTMLElement>) => {
        setSubtitleMenuAnchor(event.currentTarget);
    };

    const handleCloseSubtitleMenu = () => {
        setSubtitleMenuAnchor(null);
    };

    const handleSelectSubtitle = (index: number) => {
        if (!videoRef.current) return;

        if (index < 0) {
            // "Off" — deselect everything (file + live) and close menu.
            applyTrackModes([], false);
            updateSelectedSubtitleIndices([]);
            setLiveSelectionOverride({ track: liveTrack, selected: false });
            if (onSubtitlesToggle) onSubtitlesToggle(false);
            handleCloseSubtitleMenu();
            return;
        }

        const activeCount = selectedSubtitleIndices.length + (liveSubtitleSelected ? 1 : 0);
        let newIndices: number[];
        if (selectedSubtitleIndices.includes(index)) {
            newIndices = selectedSubtitleIndices.filter((i) => i !== index);
        } else if (activeCount < MAX_ACTIVE_TRACKS) {
            newIndices = [...selectedSubtitleIndices, index];
        } else {
            return; // already at max, ignore
        }

        applyTrackModes(newIndices, liveSubtitleSelected);
        updateSelectedSubtitleIndices(newIndices);
        if (onSubtitlesToggle) onSubtitlesToggle(newIndices.length > 0);
    };

    const handleSelectLiveSubtitle = () => {
        if (!liveAvailable) return;

        if (liveSubtitleSelected) {
            // Deselect live.
            applyTrackModes(selectedSubtitleIndices, false);
            setLiveSelectionOverride({ track: liveTrack, selected: false });
            return;
        }

        const activeCount = selectedSubtitleIndices.length;
        let nextFile = selectedSubtitleIndices;
        if (activeCount >= MAX_ACTIVE_TRACKS) {
            // Replace the oldest selected file subtitle with live.
            nextFile = selectedSubtitleIndices.slice(1);
        }
        applyTrackModes(nextFile, true);
        updateSelectedSubtitleIndices(nextFile);
        setLiveSelectionOverride({ track: liveTrack, selected: true });
    };

    const initializeSubtitles = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        const tracks = e.currentTarget.textTracks;
        const shouldShow = initialSubtitlesEnabled && subtitles.length > 0;

        const newIndices = shouldShow && tracks.length > 0 ? [0] : [];
        for (let i = 0; i < subtitles.length && i < tracks.length; i++) {
            setTextTrackMode(tracks[i], newIndices.includes(i) ? 'showing' : 'hidden');
        }
        updateSelectedSubtitleIndices(newIndices);
    };

    return {
        subtitlesEnabled,
        selectedSubtitleIndices,
        subtitleMenuAnchor,
        liveSubtitleAvailable: liveAvailable,
        liveSubtitleSelected,
        liveSubtitleLabel: liveSubtitle?.label ?? '',
        handleSubtitleClick,
        handleCloseSubtitleMenu,
        handleSelectSubtitle,
        handleSelectLiveSubtitle,
        initializeSubtitles,
    };
};
