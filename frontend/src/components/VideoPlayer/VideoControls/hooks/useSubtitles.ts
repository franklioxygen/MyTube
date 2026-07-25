import { useEffect, useState } from 'react';

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

const applyTextTrackModes = (
    video: HTMLVideoElement | null,
    fileTrackCount: number,
    fileIndices: number[],
    liveTrack: TextTrack | null,
    liveSelected: boolean
) => {
    if (video) {
        const tracks = video.textTracks;
        for (let i = 0; i < fileTrackCount && i < tracks.length; i++) {
            tracks[i].mode = fileIndices.includes(i) ? 'showing' : 'hidden';
        }
    }
    if (liveTrack) {
        liveTrack.mode = liveSelected ? 'showing' : 'hidden';
    }
};

export const useSubtitles = ({
    subtitles,
    initialSubtitlesEnabled,
    videoRef,
    onSubtitlesToggle,
    liveSubtitle,
    forceLiveSubtitleOnAvailable = false,
}: UseSubtitlesProps) => {
    const liveAvailable = liveSubtitle?.available === true;
    const subtitleKey = subtitles
        .map((subtitle) => `${subtitle.language}:${subtitle.filename}:${subtitle.path}`)
        .join('|');
    const initialFileIndices =
        initialSubtitlesEnabled && subtitles.length > 0 ? [0] : [];
    const initiallySelectLive =
        liveAvailable &&
        (initialSubtitlesEnabled || forceLiveSubtitleOnAvailable);
    const [selectionState, setSelectionState] = useState(() => ({
        subtitleKey,
        liveAvailable,
        forceLiveSubtitleOnAvailable,
        fileIndices:
            initiallySelectLive && initialFileIndices.length >= MAX_ACTIVE_TRACKS
                ? initialFileIndices.slice(1)
                : initialFileIndices,
        liveSelected: initiallySelectLive,
    }));
    let currentSelection = selectionState;
    if (
        selectionState.subtitleKey !== subtitleKey ||
        selectionState.liveAvailable !== liveAvailable ||
        selectionState.forceLiveSubtitleOnAvailable !== forceLiveSubtitleOnAvailable
    ) {
        let fileIndices =
            selectionState.subtitleKey === subtitleKey
                ? selectionState.fileIndices
                : initialFileIndices;
        let liveSelected = selectionState.liveSelected;
        const liveBecameAvailable =
            liveAvailable && !selectionState.liveAvailable;
        const forceBecameEnabled =
            forceLiveSubtitleOnAvailable &&
            !selectionState.forceLiveSubtitleOnAvailable;

        if (!liveAvailable) {
            liveSelected = false;
        } else if (
            (liveBecameAvailable &&
                (initialSubtitlesEnabled || forceLiveSubtitleOnAvailable)) ||
            forceBecameEnabled
        ) {
            if (fileIndices.length >= MAX_ACTIVE_TRACKS) {
                fileIndices = fileIndices.slice(1);
            }
            liveSelected = true;
        } else if (liveBecameAvailable) {
            liveSelected = false;
        }

        currentSelection = {
            subtitleKey,
            liveAvailable,
            forceLiveSubtitleOnAvailable,
            fileIndices,
            liveSelected,
        };
        setSelectionState(currentSelection);
    }
    const selectedSubtitleIndices = currentSelection.fileIndices;
    const liveSubtitleSelected = currentSelection.liveSelected;
    const subtitlesEnabled =
        selectedSubtitleIndices.length > 0 || liveSubtitleSelected;
    const [subtitleMenuAnchor, setSubtitleMenuAnchor] = useState<null | HTMLElement>(null);

    // TextTrack is an external browser object. Keep it synchronized with the
    // React-owned selection without changing React state from this effect.
    useEffect(() => {
        applyTextTrackModes(
            videoRef.current,
            subtitles.length,
            selectedSubtitleIndices,
            liveSubtitle?.track ?? null,
            liveSubtitleSelected
        );
    }, [
        liveSubtitle?.track,
        liveSubtitleSelected,
        selectedSubtitleIndices,
        subtitles.length,
        videoRef,
    ]);

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
            setSelectionState({ ...currentSelection, fileIndices: [], liveSelected: false });
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

        setSelectionState({ ...currentSelection, fileIndices: newIndices });
        if (onSubtitlesToggle) onSubtitlesToggle(newIndices.length > 0);
    };

    const handleSelectLiveSubtitle = () => {
        if (!liveAvailable) return;

        if (liveSubtitleSelected) {
            // Deselect live.
            setSelectionState({ ...currentSelection, liveSelected: false });
            return;
        }

        const activeCount = selectedSubtitleIndices.length;
        let nextFile = selectedSubtitleIndices;
        if (activeCount >= MAX_ACTIVE_TRACKS) {
            // Replace the oldest selected file subtitle with live.
            nextFile = selectedSubtitleIndices.slice(1);
        }
        setSelectionState({
            ...currentSelection,
            fileIndices: nextFile,
            liveSelected: true,
        });
    };

    const initializeSubtitles = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        const tracks = e.currentTarget.textTracks;
        const shouldShow = initialSubtitlesEnabled && subtitles.length > 0;

        const newIndices = shouldShow && tracks.length > 0 ? [0] : [];
        for (let i = 0; i < subtitles.length && i < tracks.length; i++) {
            tracks[i].mode = newIndices.includes(i) ? 'showing' : 'hidden';
        }
        setSelectionState({
            ...currentSelection,
            fileIndices: newIndices,
        });
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
