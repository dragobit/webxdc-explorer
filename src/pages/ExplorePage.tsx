import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Search } from 'lucide-react';

import { AppCard } from '@/components/explore/AppCard';
import { UpdateRow } from '@/components/app-detail/UpdateRow';
import { ViewToggle, type ViewMode } from '@/components/webxdc/ViewToggle';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useWebxdcAppSearch } from '@/hooks/useWebxdcAppSearch';
import { useWebxdcUpdateSearch } from '@/hooks/useWebxdcUpdateSearch';
import { cn } from '@/lib/utils';

const ExplorePage = () => {
  useSeoMeta({
    title: 'Explore · webxdc explorer',
    description: 'Search webxdc apps shared on Nostr (NIP-DC).',
  });

  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);
  const [view, setView] = useLocalStorage<ViewMode>('webxdc:explore-view', 'grid');
  const [tab, setTab] = useState<'apps' | 'updates'>('apps');

  useEffect(() => {
    const t = setTimeout(() => {
      setParams(input.trim() ? { q: input.trim() } : {}, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [input, setParams]);

  const apps = useWebxdcAppSearch(q);
  const updates = useWebxdcUpdateSearch(q);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Explore</h1>
        <p className="text-sm text-muted-foreground">
          webxdc apps and their state updates on Nostr
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search apps and updates — name, payload, webxdc id…"
          className="pl-9"
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'apps' | 'updates')}>
        <div className="flex items-center justify-between gap-4">
          <TabsList>
            <TabsTrigger value="apps">
              Apps{apps.data ? ` (${apps.data.length})` : ''}
            </TabsTrigger>
            <TabsTrigger value="updates">
              Updates{updates.data ? ` (${updates.data.length})` : ''}
            </TabsTrigger>
          </TabsList>
          {tab === 'apps' && <ViewToggle value={view} onChange={setView} />}
        </div>

        <TabsContent value="apps" className="mt-4">
          {apps.isLoading ? (
            <div className={cn(view === 'grid' && 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3')}>
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <Skeleton key={n} className={view === 'grid' ? 'h-32 w-full' : 'h-16 w-full'} />
              ))}
            </div>
          ) : apps.isError ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Failed to load apps.
              </CardContent>
            </Card>
          ) : apps.data?.length ? (
            view === 'grid' ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {apps.data.map((e) => (
                  <AppCard key={e.id} event={e} mode="grid" />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="px-4 py-0">
                  {apps.data.map((e) => (
                    <AppCard key={e.id} event={e} mode="list" />
                  ))}
                </CardContent>
              </Card>
            )
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                {q ? `No webxdc apps match "${q}".` : 'No webxdc apps found on your relays.'}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="updates" className="mt-4">
          {updates.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((n) => (
                <Skeleton key={n} className="h-16 w-full" />
              ))}
            </div>
          ) : updates.isError ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Failed to load updates.
              </CardContent>
            </Card>
          ) : updates.data?.length ? (
            <Card>
              <CardContent className="px-4 py-0">
                {updates.data.map((e) => (
                  <UpdateRow key={e.id} event={e} />
                ))}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                {q ? `No updates match "${q}".` : 'No webxdc updates found on your relays.'}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ExplorePage;
