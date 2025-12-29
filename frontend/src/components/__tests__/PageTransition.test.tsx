import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PageTransition from '../PageTransition';

describe('PageTransition', () => {
    it('should render children', () => {
        render(
            <PageTransition>
                <div data-testid="child">Child Content</div>
            </PageTransition>
        );
        expect(screen.getByTestId('child')).toBeInTheDocument();
        expect(screen.getByText('Child Content')).toBeInTheDocument();
    });
});
