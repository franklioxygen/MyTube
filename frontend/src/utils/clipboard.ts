export const copyTextToClipboard = async (text: string): Promise<boolean> => {
    const clipboardWriteText =
        typeof navigator.clipboard?.writeText === 'function'
            ? navigator.clipboard.writeText.bind(navigator.clipboard)
            : null;

    if (clipboardWriteText) {
        await clipboardWriteText(text);
        return true;
    }

    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        return document.execCommand('copy');
    } finally {
        document.body.removeChild(textArea);
    }
};
