import type { ComponentProps, FC } from 'react';
import VideoControls from './VideoControls';

type AudioModePlayerProps = ComponentProps<typeof VideoControls>;

/**
 * Audio presentation wrapper. VideoControls still owns the single HTML5
 * video element and all playback/resume/statistics hooks.
 */
const AudioModePlayer: FC<AudioModePlayerProps> = (props) => (
  <VideoControls {...props} audioMode />
);

export default AudioModePlayer;
