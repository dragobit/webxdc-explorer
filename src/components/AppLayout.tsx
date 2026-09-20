import { Blocks } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';

import { LoginArea } from '@/components/auth/LoginArea';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', label: 'Explore', end: true },
  { to: '/apps', label: 'My Apps', end: false },
];

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <NavLink to="/" className="flex items-center gap-2 font-semibold">
            <Blocks className="size-5 text-primary" />
            webxdc explorer
          </NavLink>
          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground',
                    isActive && 'bg-accent text-foreground',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <LoginArea className="max-w-40" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
