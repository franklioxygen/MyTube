import {
    Autocomplete,
    Box,
    Checkbox,
    FormControlLabel,
    FormGroup,
    MenuItem,
    Select,
    Slider,
    TextField,
    Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { RssFilters } from '../../../utils/rssApi';

interface VideoOption {
    channelUrl: string;
    author: string;
}

interface RssFilterEditorProps {
    filters: RssFilters;
    onChange: (filters: RssFilters) => void;
    channelOptions?: VideoOption[];
    authorOptions?: string[];
    tagOptions?: string[];
}

const VALID_SOURCES = ['youtube', 'bilibili', 'twitch', 'local', 'missav', 'cloud'] as const;
const DAY_RANGE_OPTIONS = [7, 30, 90, 180, 365] as const;

const omitSources = (filters: RssFilters): RssFilters => {
    const next = { ...filters };
    delete next.sources;
    return next;
};

const RssFilterEditor: React.FC<RssFilterEditorProps> = ({
    filters,
    onChange,
    channelOptions = [],
    authorOptions = [],
    tagOptions = [],
}) => {
    const { t } = useLanguage();

    const selectedChannelUrls = filters.channelUrls ?? [];
    const selectedAuthors = filters.authors ?? [];
    const selectedTags = filters.tags ?? [];
    const selectedSources = filters.sources ?? [];
    const maxItems = filters.maxItems ?? 50;

    const channelsSelected = selectedChannelUrls.length > 0;
    const sourcesUnrestricted = selectedSources.length === 0;

    const handleChannelChange = (_: unknown, values: VideoOption[]) => {
        const urls = values.map((v) => v.channelUrl);
        onChange({ ...filters, channelUrls: urls, authors: [] });
    };

    const handleAuthorChange = (_: unknown, values: string[]) => {
        onChange({ ...filters, authors: values });
    };

    const handleTagChange = (_: unknown, values: string[]) => {
        onChange({ ...filters, tags: values });
    };

    const handleSourceToggle = (source: string) => {
        const current = selectedSources.includes(source)
            ? selectedSources.filter((s) => s !== source)
            : [...selectedSources, source];
        onChange(current.length > 0 ? { ...filters, sources: current } : omitSources(filters));
    };

    const handleAllSourcesChange = () => {
        onChange(omitSources(filters));
    };

    const handleDayRangeChange = (event: SelectChangeEvent<number | ''>) => {
        const val = event.target.value;
        onChange({ ...filters, dayRange: val === '' ? undefined : Number(val) });
    };

    const handleMaxItemsChange = (_: unknown, value: number | number[]) => {
        onChange({ ...filters, maxItems: typeof value === 'number' ? value : value[0] });
    };

    const selectedChannelObjects = channelOptions.filter((opt) =>
        selectedChannelUrls.includes(opt.channelUrl)
    );

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Channel URLs */}
            <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    {t('rssFilterChannels')}
                </Typography>
                <Autocomplete
                    multiple
                    options={channelOptions}
                    getOptionLabel={(opt) => opt.author || opt.channelUrl}
                    isOptionEqualToValue={(opt, val) => opt.channelUrl === val.channelUrl}
                    value={selectedChannelObjects}
                    onChange={handleChannelChange}
                    renderInput={(params) => (
                        <TextField {...params} placeholder={t('rssFilterChannels')} size="small" />
                    )}
                    size="small"
                />
            </Box>

            {/* Authors are disabled when channel URLs are selected */}
            <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    {t('rssFilterAuthors')}
                </Typography>
                <Autocomplete
                    multiple
                    options={authorOptions}
                    value={selectedAuthors}
                    onChange={handleAuthorChange}
                    disabled={channelsSelected}
                    freeSolo
                    renderInput={(params) => (
                        <TextField
                            {...params}
                            placeholder={
                                channelsSelected
                                    ? t('rssChannelsSelectedAuthorDisabled')
                                    : t('rssFilterAuthors')
                            }
                            size="small"
                        />
                    )}
                    size="small"
                />
            </Box>

            {/* Tags */}
            <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    {t('rssFilterTags')}
                </Typography>
                <Autocomplete
                    multiple
                    options={tagOptions}
                    value={selectedTags}
                    onChange={handleTagChange}
                    freeSolo
                    renderInput={(params) => (
                        <TextField {...params} placeholder={t('rssFilterTags')} size="small" />
                    )}
                    size="small"
                />
            </Box>

            {/* Sources */}
            <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    {t('rssFilterSources')}
                </Typography>
                <FormGroup row>
                    <FormControlLabel
                        control={
                            <Checkbox
                                size="small"
                                checked={sourcesUnrestricted}
                                onChange={handleAllSourcesChange}
                            />
                        }
                        label={t('rssFilterAllSources')}
                    />
                    {VALID_SOURCES.map((source) => (
                        <FormControlLabel
                            key={source}
                            control={
                                <Checkbox
                                    size="small"
                                    checked={selectedSources.includes(source)}
                                    onChange={() => {
                                        handleSourceToggle(source);
                                    }}
                                />
                            }
                            label={source}
                        />
                    ))}
                </FormGroup>
            </Box>

            {/* Recent days */}
            <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    {t('rssFilterRecentDays')}
                </Typography>
                <Select
                    size="small"
                    value={filters.dayRange ?? ''}
                    onChange={handleDayRangeChange}
                    displayEmpty
                    sx={{ minWidth: 140 }}
                >
                    <MenuItem value="">{t('rssFilterAllVideos')}</MenuItem>
                    {DAY_RANGE_OPTIONS.map((d) => (
                        <MenuItem key={d} value={d}>
                            {t('rssDays', { days: d })}
                        </MenuItem>
                    ))}
                </Select>
            </Box>

            {/* Max items */}
            <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    {t('rssFilterMaxItems')}: {maxItems}
                </Typography>
                <Slider
                    min={10}
                    max={200}
                    step={10}
                    value={maxItems}
                    onChange={handleMaxItemsChange}
                    valueLabelDisplay="auto"
                    sx={{ maxWidth: 300 }}
                />
            </Box>
        </Box>
    );
};

export default RssFilterEditor;
