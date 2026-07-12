import { useEffect, useRef, useState } from 'react';

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

export const useSubtitles = ({
    subtitles,
    initialSubtitlesEnabled,
    videoRef,
    onSubtitlesToggle,
    liveSubtitle,
    forceLiveSubtitleOnAvailable = false,
}: UseSubtitlesProps) => {
    const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(
        initialSubtitlesEnabled && subtitles.length > 0
    );
    const [selectedSubtitleIndices, setSelectedSubtitleIndices] = useState<number[]>(
        initialSubtitlesEnabled && subtitles.length > 0 ? [0] : []
    );
    const [liveSubtitleSelected, setLiveSubtitleSelected] = useState<boolean>(false);
    const [subtitleMenuAnchor, setSubtitleMenuAnchor] = useState<null | HTMLElement>(null);

    const liveAvailable = liveSubtitle?.available === true;
    const prevLiveAvailableRef = useRef(false);
    const prevForceLiveSubtitleRef = useRef(false);

    // Apply showing/hidden modes by identity: file tracks occupy textTracks
    // [0..subtitles.length-1] (in array order); the dynamic live track — added via
    // addTextTrack — always sorts after them, so we address it by reference and
    // never by index. File-driven effects must not touch it.
    const applyTrackModes = (fileIndices: number[], liveSelected: boolean) => {
        const video = videoRef.current;
        if (video) {
            const tracks = video.textTracks;
            for (let i = 0; i < subtitles.length && i < tracks.length; i++) {
                tracks[i].mode = fileIndices.includes(i) ? 'showing' : 'hidden';
            }
        }
        const liveTrack = liveSubtitle?.track;
        if (liveTrack) {
            liveTrack.mode = liveSelected ? 'showing' : 'hidden';
        }
    };

    const selectLiveSubtitleTrack = () => {
        setSelectedSubtitleIndices((fileIndices) => {
            let nextFile = fileIndices;
            if (fileIndices.length >= MAX_ACTIVE_TRACKS) {
                // Replace the oldest selected file subtitle.
                nextFile = fileIndices.slice(1);
            }
            applyTrackModes(nextFile, true);
            return nextFile;
        });
        setLiveSubtitleSelected(true);
        setSubtitlesEnabled(true);
    };

    // Re-initialize FILE subtitle tracks only when the subtitles array changes
    // (upload/delete). Must not include initialSubtitlesEnabled (feedback loop)
    // and must preserve the live selection/track.
    useEffect(() => {
        if (!videoRef.current || subtitles.length === 0) return;

        const tracks = videoRef.current.textTracks;
        const newIndices = initialSubtitlesEnabled && tracks.length > 0 ? [0] : [];

        setSelectedSubtitleIndices(newIndices);
        setSubtitlesEnabled(initialSubtitlesEnabled || liveSubtitleSelected);

        for (let i = 0; i < subtitles.length && i < tracks.length; i++) {
            tracks[i].mode = newIndices.includes(i) ? 'showing' : 'hidden';
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subtitles]); // intentionally omit initialSubtitlesEnabled — see comment above

    // Auto-select the live track when it becomes available if subtitles are
    // globally enabled, or when subtitle-only live translation requires captions
    // as its only output. Otherwise keep the live option in the menu without showing it.
    useEffect(() => {
        const wasAvailable = prevLiveAvailableRef.current;
        const wasForceLiveSubtitle = prevForceLiveSubtitleRef.current;
        prevLiveAvailableRef.current = liveAvailable;
        prevForceLiveSubtitleRef.current = forceLiveSubtitleOnAvailable;

        const shouldAutoSelectLive =
            initialSubtitlesEnabled || forceLiveSubtitleOnAvailable;

        if (liveAvailable && !wasAvailable) {
            if (shouldAutoSelectLive) {
                selectLiveSubtitleTrack();
            } else {
                applyTrackModes(selectedSubtitleIndices, false);
                setLiveSubtitleSelected(false);
                setSubtitlesEnabled(selectedSubtitleIndices.length > 0);
            }
        } else if (!liveAvailable && wasAvailable) {
            setLiveSubtitleSelected(false);
            setSelectedSubtitleIndices((fileIndices) => {
                applyTrackModes(fileIndices, false);
                setSubtitlesEnabled(fileIndices.length > 0);
                return fileIndices;
            });
        } else if (
            liveAvailable &&
            forceLiveSubtitleOnAvailable &&
            !wasForceLiveSubtitle
        ) {
            // Subtitle-only mode became active after the live track already existed.
            selectLiveSubtitleTrack();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveAvailable, forceLiveSubtitleOnAvailable]);

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
            setSelectedSubtitleIndices([]);
            setLiveSubtitleSelected(false);
            setSubtitlesEnabled(false);
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
        setSelectedSubtitleIndices(newIndices);
        const enabled = newIndices.length > 0 || liveSubtitleSelected;
        setSubtitlesEnabled(enabled);
        if (onSubtitlesToggle) onSubtitlesToggle(newIndices.length > 0);
    };

    const handleSelectLiveSubtitle = () => {
        if (!liveAvailable) return;

        if (liveSubtitleSelected) {
            // Deselect live.
            applyTrackModes(selectedSubtitleIndices, false);
            setLiveSubtitleSelected(false);
            setSubtitlesEnabled(selectedSubtitleIndices.length > 0);
            return;
        }

        const activeCount = selectedSubtitleIndices.length;
        let nextFile = selectedSubtitleIndices;
        if (activeCount >= MAX_ACTIVE_TRACKS) {
            // Replace the oldest selected file subtitle with live.
            nextFile = selectedSubtitleIndices.slice(1);
        }
        applyTrackModes(nextFile, true);
        setSelectedSubtitleIndices(nextFile);
        setLiveSubtitleSelected(true);
        setSubtitlesEnabled(true);
    };

    const initializeSubtitles = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        const tracks = e.currentTarget.textTracks;
        const shouldShow = initialSubtitlesEnabled && subtitles.length > 0;

        const newIndices = shouldShow && tracks.length > 0 ? [0] : [];
        for (let i = 0; i < subtitles.length && i < tracks.length; i++) {
            tracks[i].mode = newIndices.includes(i) ? 'showing' : 'hidden';
        }
        setSelectedSubtitleIndices(newIndices);
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
