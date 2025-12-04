
/**
 * Convert Bilibili BCC subtitle format to WebVTT
 */

interface BccItem {
    from: number;
    to: number;
    location: number;
    content: string;
}

interface BccBody {
    font_size: number;
    font_color: string;
    background_alpha: number;
    background_color: string;
    Stroke: string;
    type: string;
    lang: string;
    version: string;
    body: BccItem[];
}

function formatTime(seconds: number): string {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    const hh = date.getUTCHours().toString().padStart(2, '0');
    const mm = date.getUTCMinutes().toString().padStart(2, '0');
    const ss = date.getUTCSeconds().toString().padStart(2, '0');
    const ms = date.getUTCMilliseconds().toString().padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
}

export function bccToVtt(bccContent: BccBody | string): string {
    let bcc: BccBody;
    
    if (typeof bccContent === 'string') {
        try {
            bcc = JSON.parse(bccContent);
        } catch (e) {
            console.error('Failed to parse BCC content', e);
            return '';
        }
    } else {
        bcc = bccContent;
    }

    if (!bcc.body || !Array.isArray(bcc.body)) {
        return '';
    }

    let vtt = 'WEBVTT\n\n';

    bcc.body.forEach((item) => {
        const start = formatTime(item.from);
        const end = formatTime(item.to);
        vtt += `${start} --> ${end}\n`;
        vtt += `${item.content}\n\n`;
    });

    return vtt;
}
