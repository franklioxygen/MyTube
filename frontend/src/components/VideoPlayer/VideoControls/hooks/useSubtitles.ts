import { useEffect, useState } from 'react';

interface Subtitle {
    language: string;
    filename: string;
    path: string;
}

interface UseSubtitlesProps {
    subtitles: Subtitle[];
    initialSubtitlesEnabled: boolean;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    onSubtitlesToggle?: (enabled: boolean) => void;
}

export const useSubtitles = ({
    subtitles,
    initialSubtitlesEnabled,
    videoRef,
    onSubtitlesToggle
}: UseSubtitlesProps) => {
    const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(
        initialSubtitlesEnabled && subtitles.length > 0
    );
    const [selectedSubtitleIndices, setSelectedSubtitleIndices] = useState<number[]>(
        initialSubtitlesEnabled && subtitles.length > 0 ? [0] : []
    );
    const [subtitleMenuAnchor, setSubtitleMenuAnchor] = useState<null | HTMLElement>(null);

    // Re-initialize subtitle tracks only when the subtitles array itself changes
    // (e.g., after upload or delete). Must NOT include initialSubtitlesEnabled in
    // the deps — doing so creates a feedback loop: selecting a subtitle calls
    // onSubtitlesToggle → parent updates subtitlesEnabled → initialSubtitlesEnabled
    // changes → this effect resets selectedSubtitleIndices back to [0].
    useEffect(() => {
        if (!videoRef.current || subtitles.length === 0) return;

        const tracks = videoRef.current.textTracks;
        const newIndices = initialSubtitlesEnabled && tracks.length > 0 ? [0] : [];

        setSubtitlesEnabled(initialSubtitlesEnabled);
        setSelectedSubtitleIndices(newIndices);

        Array.from(tracks).forEach((track) => {
            track.mode = 'hidden';
        });
        if (newIndices.length > 0) {
            const [firstTrack] = Array.from(tracks);
            if (firstTrack) {
                firstTrack.mode = 'showing';
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subtitles]); // intentionally omit initialSubtitlesEnabled — see comment above

    const handleSubtitleClick = (event: React.MouseEvent<HTMLElement>) => {
        setSubtitleMenuAnchor(event.currentTarget);
    };

    const handleCloseSubtitleMenu = () => {
        setSubtitleMenuAnchor(null);
    };

    const handleSelectSubtitle = (index: number) => {
        if (!videoRef.current) return;

        const tracks = videoRef.current.textTracks;
        let newIndices: number[];

        if (index < 0) {
            // "Off" — deselect all and close menu
            newIndices = [];
            handleCloseSubtitleMenu();
        } else {
            // Toggle the selected index (max 2 active at once)
            if (selectedSubtitleIndices.includes(index)) {
                newIndices = selectedSubtitleIndices.filter(i => i !== index);
            } else if (selectedSubtitleIndices.length < 2) {
                newIndices = [...selectedSubtitleIndices, index];
            } else {
                return; // Already 2 selected, ignore
            }
            // Keep menu open so user can pick a second subtitle
        }

        Array.from(tracks).forEach((track, trackIndex) => {
            track.mode = newIndices.includes(trackIndex) ? 'showing' : 'hidden';
        });

        setSelectedSubtitleIndices(newIndices);
        const enabled = newIndices.length > 0;
        setSubtitlesEnabled(enabled);
        if (onSubtitlesToggle) onSubtitlesToggle(enabled);
    };

    const initializeSubtitles = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        const tracks = e.currentTarget.textTracks;
        const shouldShow = initialSubtitlesEnabled && subtitles.length > 0;

        Array.from(tracks).forEach((track) => {
            track.mode = 'hidden';
        });

        const newIndices = shouldShow && tracks.length > 0 ? [0] : [];
        if (newIndices.length > 0) {
            const [firstTrack] = Array.from(tracks);
            if (firstTrack) {
                firstTrack.mode = 'showing';
            }
        }
        setSelectedSubtitleIndices(newIndices);
    };

    return {
        subtitlesEnabled,
        selectedSubtitleIndices,
        subtitleMenuAnchor,
        handleSubtitleClick,
        handleCloseSubtitleMenu,
        handleSelectSubtitle,
        initializeSubtitles
    };
};
