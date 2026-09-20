import { useSeoMeta } from '@unhead/react';
import { Blocks } from 'lucide-react';

import { MyAppEntry } from '@/components/my-apps/MyAppEntry';
import { ViewToggle, type ViewMode } from '@/components/webxdc/ViewToggle';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useMyWebxdcApps } from '@/hooks/useMyWebxdcApps';
import { cn } from '@/lib/utils';

const MyAppsPage = () => {
  useSeoMeta({
    title: 'My Apps · webxdc explorer',
    description: 'webxdc apps you have used on Nostr.',
  });

  const { user } = useCurrentUser();
  const [view, setView] = useLocalStorage<ViewMode>('webxdc:myapps-view', 'grid');
  const apps = useMyWebxdcApps(user?.pubkey);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">My Apps</h1>
          <p className="text-sm text-muted-foreground">
            webxdc apps you&apos;ve participated in
          </p>
        </div>
        {user && <ViewToggle value={view} onChange={setView} />}
      </div>

      {!user ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Blocks className="size-8 text-muted-foreground" />
            <p className="font-medium">Log in to see the webxdc apps you&apos;ve used</p>
            <p className="text-sm text-muted-foreground">
              Your participation is derived from kind 4932 updates you&apos;ve published.
            </p>
          </CardContent>
        </Card>
      ) : apps.isLoading ? (
        <div className={cn(view === 'grid' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3' : 'space-y-0')}>
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <Skeleton key={n} className={view === 'grid' ? 'h-32 w-full' : 'h-16 w-full'} />
          ))}
        </div>
      ) : apps.isError ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Failed to load your apps.
          </CardContent>
        </Card>
      ) : apps.data?.length ? (
        view === 'grid' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {apps.data.map((app) => (
              <MyAppEntry key={app.identifier} app={app} mode="grid" />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="px-4 py-0">
              {apps.data.map((app) => (
                <MyAppEntry key={app.identifier} app={app} mode="list" />
              ))}
            </CardContent>
          </Card>
        )
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Blocks className="size-8 text-muted-foreground" />
            <p className="font-medium">You haven&apos;t used any webxdc apps yet</p>
            <p className="text-sm text-muted-foreground">
              When your kind 4932 updates appear on relays, they&apos;ll show up here.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default MyAppsPage;
