import { useMemo } from 'react';

interface GridProps {
    xs: number;
    sm: number;
    md?: number;
    lg: number;
    xl: number;
}

interface UseGridLayoutProps {
    isSidebarOpen: boolean;
    videoColumns: number;
}

export const useGridLayout = ({ isSidebarOpen, videoColumns }: UseGridLayoutProps): GridProps => {
    return useMemo(() => {
        if (isSidebarOpen) {
            if (videoColumns === 2) return { xs: 12, sm: 6, lg: 6, xl: 6 };
            if (videoColumns === 3) return { xs: 12, sm: 6, lg: 4, xl: 4 };
            if (videoColumns === 4) return { xs: 12, sm: 6, lg: 4, xl: 3 };
            if (videoColumns === 5) return { xs: 12, sm: 6, md: 4, lg: 3, xl: 2 };
            return { xs: 12, sm: 6, md: 4, lg: 3, xl: 2 }; // 6 columns
        } else {
            if (videoColumns === 2) return { xs: 12, sm: 6, lg: 6, xl: 6 };
            if (videoColumns === 3) return { xs: 12, sm: 6, md: 4, lg: 4, xl: 4 };
            if (videoColumns === 4) return { xs: 12, sm: 6, md: 4, lg: 3, xl: 3 };
            if (videoColumns === 5) return { xs: 12, sm: 6, md: 4, lg: 2, xl: 2 };
            return { xs: 12, sm: 6, md: 4, lg: 2, xl: 2 }; // 6 columns
        }
    }, [isSidebarOpen, videoColumns]);
};
