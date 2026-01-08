import bellding from '../assets/sounds/bellding-254774.mp3';
import messageIncoming from '../assets/sounds/message-incoming-132126.mp3';
import microwaveDing from '../assets/sounds/microwave-ding-104123.mp3';
import newNotification from '../assets/sounds/new-notification-020-352772.mp3';
import objectDropsInWater from '../assets/sounds/object-drops-in-water-84639.mp3';
import waterdropOnMetal from '../assets/sounds/waterdrop-on-metal-406648.mp3';
import { TranslationKey } from './translations';

export const INFO_SOUNDS: Record<string, string> = {
    'bellding-254774.mp3': bellding,
    'message-incoming-132126.mp3': messageIncoming,
    'microwave-ding-104123.mp3': microwaveDing,
    'new-notification-020-352772.mp3': newNotification,
    'object-drops-in-water-84639.mp3': objectDropsInWater,
    'waterdrop-on-metal-406648.mp3': waterdropOnMetal,
};

interface SoundOption {
    value: string;
    labelKey: TranslationKey;
}

export const SOUND_OPTIONS: SoundOption[] = [
    { value: '', labelKey: 'soundNone' },
    { value: 'bellding-254774.mp3', labelKey: 'soundBell' },
    { value: 'message-incoming-132126.mp3', labelKey: 'soundMessage' },
    { value: 'microwave-ding-104123.mp3', labelKey: 'soundMicrowave' },
    { value: 'new-notification-020-352772.mp3', labelKey: 'soundNotification' },
    { value: 'object-drops-in-water-84639.mp3', labelKey: 'soundDrop' },
    { value: 'waterdrop-on-metal-406648.mp3', labelKey: 'soundWater' },
];
