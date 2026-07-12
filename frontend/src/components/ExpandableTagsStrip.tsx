import { LocalOffer } from '@mui/icons-material';
import { Box, Button, Chip } from '@mui/material';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

const DEFAULT_MAX_COLLAPSED_LINES = 3;
const CHIP_ROW_GAP_PX = 8;
const FALLBACK_CHIP_HEIGHT_PX = 32;

export interface ExpandableTagsStripProps {
    tags: string[];
    selectedTags: string[];
    onTagToggle: (tag: string) => void;
    maxCollapsedLines?: number;
    /** Test hook; default uses scrollHeight vs clientHeight. */
    measureOverflow?: (element: HTMLElement) => boolean;
}

const defaultMeasureOverflow = (element: HTMLElement): boolean =>
    element.scrollHeight > element.clientHeight + 1;

const ExpandableTagsStrip: React.FC<ExpandableTagsStripProps> = ({
    tags,
    selectedTags,
    onTagToggle,
    maxCollapsedLines = DEFAULT_MAX_COLLAPSED_LINES,
    measureOverflow = defaultMeasureOverflow,
}) => {
    const { t } = useLanguage();
    const [expanded, setExpanded] = useState(false);
    const [hasOverflow, setHasOverflow] = useState(false);
    const [lineHeightPx, setLineHeightPx] = useState(
        FALLBACK_CHIP_HEIGHT_PX + CHIP_ROW_GAP_PX
    );
    const containerRef = useRef<HTMLDivElement>(null);
    const chipMeasureRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const chipEl = chipMeasureRef.current?.querySelector('.MuiChip-root') as HTMLElement | null;
        if (chipEl) {
            setLineHeightPx(chipEl.offsetHeight + CHIP_ROW_GAP_PX);
        }
    }, [tags, selectedTags]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const updateOverflow = () => {
            if (expanded) {
                // Measure as if collapsed to know whether the control is needed
                const previousMaxHeight = el.style.maxHeight;
                const previousOverflow = el.style.overflow;
                el.style.maxHeight = `${maxCollapsedLines * lineHeightPx}px`;
                el.style.overflow = 'hidden';
                setHasOverflow(measureOverflow(el));
                el.style.maxHeight = previousMaxHeight;
                el.style.overflow = previousOverflow;
            } else {
                setHasOverflow(measureOverflow(el));
            }
        };

        updateOverflow();

        const observer = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(updateOverflow)
            : null;
        observer?.observe(el);
        window.addEventListener('resize', updateOverflow);

        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', updateOverflow);
        };
    }, [tags, selectedTags, expanded, maxCollapsedLines, lineHeightPx, measureOverflow]);

    if (tags.length === 0) {
        return null;
    }

    const collapsedMaxHeight = maxCollapsedLines * lineHeightPx;

    return (
        <Box sx={{ mb: 3 }}>
            <Box
                ref={containerRef}
                role="list"
                aria-label={t('tags')}
                sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: `${CHIP_ROW_GAP_PX}px`,
                    maxHeight: expanded ? 'none' : `${collapsedMaxHeight}px`,
                    overflow: expanded ? 'visible' : 'hidden',
                }}
            >
                {/* Hidden probe for measuring chip height (first chip is enough) */}
                <Box
                    ref={chipMeasureRef}
                    aria-hidden
                    sx={{
                        position: 'absolute',
                        visibility: 'hidden',
                        pointerEvents: 'none',
                        height: 0,
                        overflow: 'hidden',
                    }}
                >
                    <Chip label="measure" size="medium" />
                </Box>
                {tags.map((tag) => {
                    const isSelected = selectedTags.includes(tag);
                    return (
                        <Chip
                            key={tag}
                            role="listitem"
                            label={tag}
                            onClick={() => onTagToggle(tag)}
                            color={isSelected ? 'primary' : 'default'}
                            variant={isSelected ? 'filled' : 'outlined'}
                            icon={isSelected ? <LocalOffer sx={{ fontSize: '1rem !important' }} /> : undefined}
                            sx={{
                                cursor: 'pointer',
                                transition: 'background-color 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s',
                                '&:hover': {
                                    bgcolor: isSelected ? 'primary.dark' : 'action.hover',
                                },
                            }}
                        />
                    );
                })}
            </Box>
            {hasOverflow && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                    <Button
                        size="small"
                        onClick={() => setExpanded((prev) => !prev)}
                        aria-expanded={expanded}
                        sx={{ color: 'primary.main', fontWeight: 600, textTransform: 'none' }}
                    >
                        {expanded ? t('showLessTags') : t('showMoreTags')}
                    </Button>
                </Box>
            )}
        </Box>
    );
};

export default ExpandableTagsStrip;
