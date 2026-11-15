import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EditableTitle from '../EditableTitle';
import RemoteOriginNotice from '../RemoteOriginNotice';
import VideoRating from '../VideoRating';
import VideoTags from '../VideoTags';

vi.mock('../../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
    }),
}));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ userRole: 'admin' }) }));

// Parts of the player's info panel a remote item shows read-only: each one
// leaves out its editing control when no handler is given.
describe('read-only video info', () => {
    it('shows a title without the edit control', () => {
        render(<EditableTitle title="Remote clip" />);
        expect(screen.getByText('Remote clip')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows the rating read-only and can leave out the view count', () => {
        render(<VideoRating rating={4} viewCount={undefined} showViewCount={false} />);
        expect(screen.queryByRole('radio')).not.toBeInTheDocument();
        expect(screen.queryByText('rateThisVideo')).not.toBeInTheDocument();
        expect(screen.queryByText(/views/)).not.toBeInTheDocument();
    });

    it('shows tags as chips without a way to change them', () => {
        render(<VideoTags videoId="fed_1" tags={['music']} availableTags={[]} />);
        expect(screen.getByText('music')).toBeInTheDocument();
        expect(screen.queryByText('addTags')).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });

    it('names the source instance and warns while it is offline', () => {
        const video = {
            id: 'fed_1',
            title: 'Remote clip',
            origin: { kind: 'remote', instanceId: 'peer', instanceName: 'NAS' },
            availability: 'offline',
        } as any;
        render(<RemoteOriginNotice video={video} />);
        expect(screen.getByText('NAS')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('federationItemOffline:{"name":"NAS"}');
    });
});
