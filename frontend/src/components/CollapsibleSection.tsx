import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Accordion, AccordionDetails, AccordionSummary, Typography } from '@mui/material';
import React, { ReactNode, useState } from 'react';

interface CollapsibleSectionProps {
    title: string;
    children: ReactNode;
    defaultExpanded?: boolean;
    deferMount?: boolean;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({ title, children, defaultExpanded = true, deferMount = false }) => {
    const [hasExpanded, setHasExpanded] = useState(defaultExpanded);
    return (
        <Accordion defaultExpanded={defaultExpanded} sx={{ width: '100%', mb: 0.25 }}
            onChange={(_, expanded) => {
                if (deferMount && expanded) setHasExpanded(true);
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
