import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Accordion, AccordionDetails, AccordionSummary, Typography } from '@mui/material';
import React, { ReactNode, useState } from 'react';

interface CollapsibleSectionProps {
    title: string;
    children: ReactNode;
    defaultExpanded?: boolean;
    expanded?: boolean;
    onExpandedChange?: (expanded: boolean) => void;
    deferMount?: boolean;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({ title, children, defaultExpanded = true, expanded, onExpandedChange, deferMount = false }) => {
    const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
    const isExpanded = expanded ?? localExpanded;
    const [hasExpanded, setHasExpanded] = useState(isExpanded);
    if (isExpanded && !hasExpanded) setHasExpanded(true);
    return (
        <Accordion expanded={isExpanded} sx={{ width: '100%', mb: 0.25 }}
            onChange={(_, expanded) => {
                if (expanded) setHasExpanded(true);
                setLocalExpanded(expanded);
                onExpandedChange?.(expanded);
            }}>
            <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                aria-controls={`panel-${title.replace(/\s+/g, '-').toLowerCase()}-content`}
                id={`panel-${title.replace(/\s+/g, '-').toLowerCase()}-header`}
            >
                <Typography variant="h6">{title}</Typography>
            </AccordionSummary>
            <AccordionDetails>
                {(!deferMount || hasExpanded) && children}
            </AccordionDetails>
        </Accordion>
    );
};

export default CollapsibleSection;
