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
    const [subtitleMenuAnchor, setSubtitleMenuAnchor] = useState<null | HTMLElement>(null);

    // Sync subtitle tracks when preference changes or subtitles become available
    useEffect(() => {
        if (videoRef.current && subtitles.length > 0) {
            const tracks = videoRef.current.textTracks;
            const newState = initialSubtitlesEnabled;
            setSubtitlesEnabled(newState);

            // Hide all first
            for (let i = 0; i < tracks.length; i++) {
                tracks[i].mode = 'hidden';
            }

            // If enabled, show the first one
            if (newState && tracks.length > 0) {
                tracks[0].mode = 'showing';
            }
        }
    }, [initialSubtitlesEnabled, subtitles, videoRef]);

    const handleSubtitleClick = (event: React.MouseEvent<HTMLElement>) => {
        setSubtitleMenuAnchor(event.currentTarget);
    };

    const handleCloseSubtitleMenu = () => {
        setSubtitleMenuAnchor(null);
    };

    const handleSelectSubtitle = (index: number) => {
        if (videoRef.current) {
            const tracks = videoRef.current.textTracks;

            // Hide all tracks first
            for (let i = 0; i < tracks.length; i++) {
                tracks[i].mode = 'hidden';
            }

            if (index >= 0 && index < tracks.length) {
                tracks[index].mode = 'showing';
                setSubtitlesEnabled(true);
                if (onSubtitlesToggle) onSubtitlesToggle(true);
            } else {
                setSubtitlesEnabled(false);
                if (onSubtitlesToggle) onSubtitlesToggle(false);
            }
        }
        handleCloseSubtitleMenu();
    };

    const initializeSubtitles = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        const tracks = e.currentTarget.textTracks;
        const shouldShow = initialSubtitlesEnabled && subtitles.length > 0;

        for (let i = 0; i < tracks.length; i++) {
            tracks[i].mode = 'hidden';
        }

        if (shouldShow && tracks.length > 0) {
            tracks[0].mode = 'showing';
        }
    };

    return {
        subtitlesEnabled,
        subtitleMenuAnchor,
        handleSubtitleClick,
        handleCloseSubtitleMenu,
        handleSelectSubtitle,
        initializeSubtitles
    };
};

