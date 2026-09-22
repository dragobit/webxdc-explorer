import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Search } from 'lucide-react';

import { AppCard } from '@/components/explore/AppCard';
import { UpdateRow } from '@/components/app-detail/UpdateRow';
import { ViewToggle, type ViewMode } from '@/components/webxdc/ViewToggle';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useWebxdcAppSearch } from '@/hooks/useWebxdcAppSearch';
import { useWebxdcUpdateSearch } from '@/hooks/useWebxdcUpdateSearch';
import { useWebxdcUpdateStats } from '@/hooks/useWebxdcUpdateStats';
import { getWebxdcId } from '@/lib/webxdc';
import { compareStat, parseStatsQuery } from '@/lib/webxdcQuery';
import { cn } from '@/lib/utils';

type AppSort = 'newest' | 'updates' | 'participants' | 'active';

const ExplorePage = () => {
  useSeoMeta({
    title: 'Explore · webxdc explorer',
    description: 'Search webxdc apps shared on Nostr (NIP-DC).',
  });

  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);
  const [view, setView] = useLocalStorage<ViewMode>('webxdc:explore-view', 'grid');
  const [sort, setSort] = useLocalStorage<AppSort>('webxdc:explore-sort', 'newest');
  const [activeOnly, setActiveOnly] = useLocalStorage<boolean>('webxdc:explore-active-only', false);
  const [tab, setTab] = useState<'apps' | 'updates'>('apps');

  useEffect(() => {
    const t = setTimeout(() => {
      setParams(input.trim() ? { q: input.trim() } : {}, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [input, setParams]);

  const statsQuery = parseStatsQuery(q);
  const searchQ = statsQuery ? '' : q;
  const apps = useWebxdcAppSearch(searchQ);
  const updates = useWebxdcUpdateSearch(searchQ);

  const identifiers = useMemo(
    () => (apps.data ?? []).map(getWebxdcId).filter((id): id is string => Boolean(id)),
    [apps.data],
  );
  const stats = useWebxdcUpdateStats(identifiers);

  const visibleApps = useMemo(() => {
    const list = [...(apps.data ?? [])];
    const map = stats.data;
    const statOf = (e: (typeof list)[number]) => {
      const id = getWebxdcId(e);
      return id ? map?.get(id) : undefined;
    };

    let filtered = list;
    // While stats are still loading, don't apply stat-based filters.
    if (map) {
      if (activeOnly) filtered = filtered.filter((e) => (statOf(e)?.count ?? 0) > 0);
      if (statsQuery) {
        filtered = filtered.filter((e) => {
          const s = statOf(e);
          const actual = statsQuery.field === 'updates' ? s?.count ?? 0 : s?.participants ?? 0;
          return compareStat(actual, statsQuery.op, statsQuery.value);
        });
      }
    }

    const newest = (a: (typeof list)[number], b: (typeof list)[number]) => b.created_at - a.created_at;
    filtered.sort((a, b) => {
      const sa = statOf(a);
      const sb = statOf(b);
      switch (sort) {
        case 'updates':
          return (sb?.count ?? 0) - (sa?.count ?? 0) || newest(a, b);
        case 'participants':
          return (sb?.participants ?? 0) - (sa?.participants ?? 0) || (sb?.count ?? 0) - (sa?.count ?? 0) || newest(a, b);
        case 'active':
          return (sb?.lastUpdate ?? 0) - (sa?.lastUpdate ?? 0) || newest(a, b);
        default:
          return newest(a, b);
      }
    });
    return filtered;
  }, [apps.data, stats.data, activeOnly, statsQuery, sort]);

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
          placeholder="Search apps and updates — name, payload, webxdc id, updates>5…"
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
          {tab === 'apps' && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Checkbox
                  id="active-only"
                  checked={activeOnly}
                  onCheckedChange={(v) => setActiveOnly(v === true)}
                />
                <Label htmlFor="active-only" className="text-xs font-normal whitespace-nowrap">
                  Only with updates
                </Label>
              </div>
              <Select value={sort} onValueChange={(v) => setSort(v as AppSort)}>
                <SelectTrigger size="sm" className="w-auto text-xs" aria-label="Sort apps">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest</SelectItem>
                  <SelectItem value="updates">Most updates</SelectItem>
                  <SelectItem value="participants">Most participants</SelectItem>
                  <SelectItem value="active">Recently active</SelectItem>
                </SelectContent>
              </Select>
              <ViewToggle value={view} onChange={setView} />
            </div>
          )}
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
          ) : visibleApps.length ? (
            view === 'grid' ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visibleApps.map((e) => {
                  const id = getWebxdcId(e);
                  return <AppCard key={e.id} event={e} mode="grid" stats={id ? stats.data?.get(id) : undefined} />;
                })}
              </div>
            ) : (
              <Card>
                <CardContent className="px-4 py-0">
                  {visibleApps.map((e) => {
                    const id = getWebxdcId(e);
                    return <AppCard key={e.id} event={e} mode="list" stats={id ? stats.data?.get(id) : undefined} />;
                  })}
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
