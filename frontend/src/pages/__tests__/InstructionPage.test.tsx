import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import InstructionPage from '../InstructionPage';

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../components/Disclaimer', () => ({
    default: () => <div data-testid="disclaimer">Disclaimer</div>,
}));

describe('InstructionPage', () => {
    it('renders the page title', () => {
        render(<InstructionPage />);
        expect(screen.getByText('instruction')).toBeInTheDocument();
    });

    it('renders all three instruction sections', () => {
        render(<InstructionPage />);
        expect(screen.getByText('instructionSection1Title')).toBeInTheDocument();
        expect(screen.getByText('instructionSection2Title')).toBeInTheDocument();
        expect(screen.getByText('instructionSection3Title')).toBeInTheDocument();
    });

    it('renders section descriptions', () => {
        render(<InstructionPage />);
        expect(screen.getByText('instructionSection1Desc')).toBeInTheDocument();
        expect(screen.getByText('instructionSection2Desc')).toBeInTheDocument();
        expect(screen.getByText('instructionSection3Desc')).toBeInTheDocument();
    });

    it('renders the Disclaimer component', () => {
        render(<InstructionPage />);
        expect(screen.getByTestId('disclaimer')).toBeInTheDocument();
    });
});
