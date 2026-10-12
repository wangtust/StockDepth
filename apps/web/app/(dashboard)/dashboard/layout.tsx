'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shield,
  UserCircle
} from 'lucide-react';

export default function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const navItems = [
    { href: '/dashboard/analysis', icon: BarChart3, label: 'Analysis' },
    { href: '/dashboard/stocks', icon: BarChart3, label: 'Shared Stocks' },
    { href: '/dashboard/portfolio', icon: BriefcaseBusiness, label: 'Portfolio' },
    { href: '/dashboard', icon: UserCircle, label: 'Account' },
    { href: '/dashboard/general', icon: Settings, label: 'General' },
    { href: '/dashboard/activity', icon: Activity, label: 'Activity' },
    { href: '/dashboard/security', icon: Shield, label: 'Security' }
  ];

  return (
    <div className="flex min-h-[calc(100dvh-68px)] w-full flex-col bg-slate-50">
      {/* Mobile header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white/90 p-4 backdrop-blur lg:hidden">
        <div className="flex items-center">
          <span className="font-medium">Dashboard</span>
        </div>
        <Button
          className="-mr-2 rounded-md"
          variant="ghost"
          size="icon"
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        >
          <Menu className="h-6 w-6" />
          <span className="sr-only">Toggle sidebar</span>
        </Button>
      </div>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {isSidebarOpen && (
          <button
            aria-label="Close sidebar"
            className="absolute inset-0 z-30 bg-slate-950/20 backdrop-blur-sm lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
            type="button"
          />
        )}

        {/* Sidebar */}
        <aside
          className={cn(
            'absolute inset-y-0 left-0 z-40 w-64 transform transition-[transform,width] duration-300 ease-out lg:relative lg:inset-auto lg:z-auto lg:translate-x-0',
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
            isSidebarCollapsed ? 'lg:w-[72px]' : 'lg:w-64'
          )}
        >
          <div className="flex h-full flex-col border-r border-slate-200 bg-white/80 shadow-xl backdrop-blur-xl lg:bg-slate-100/70 lg:shadow-none">
            <div
              className={cn(
                'flex h-14 shrink-0 items-center border-b border-slate-200 px-3',
                isSidebarCollapsed ? 'lg:justify-center' : 'justify-between'
              )}
            >
              <span
                className={cn(
                  'text-sm font-semibold text-slate-800 transition-opacity',
                  isSidebarCollapsed && 'lg:hidden'
                )}
              >
                Workspace
              </span>
              <Button
                aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className="hidden size-8 rounded-md text-slate-600 hover:text-slate-950 lg:inline-flex"
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                size="icon"
                title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                type="button"
                variant="ghost"
              >
                {isSidebarCollapsed ? (
                  <PanelLeftOpen className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
              </Button>
            </div>

            <nav className="flex-1 overflow-y-auto p-3">
              {navItems.map((item) => {
                const isActive = pathname === item.href || (item.href === '/dashboard/stocks' && pathname.startsWith('/dashboard/stocks/'));

                return (
                  <Link key={item.href} href={item.href} passHref>
                    <Button
                      aria-label={item.label}
                      title={isSidebarCollapsed ? item.label : undefined}
                      variant={isActive ? 'secondary' : 'ghost'}
                      className={cn(
                        'my-1 h-10 w-full rounded-md shadow-none',
                        isSidebarCollapsed ? 'lg:justify-center lg:px-0' : 'justify-start',
                        isActive
                          ? 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200'
                          : 'text-slate-600 hover:bg-white/80 hover:text-slate-950'
                      )}
                      onClick={() => setIsSidebarOpen(false)}
                    >
                      <item.icon className="h-4 w-4" />
                      <span
                        className={cn(
                          'transition-opacity',
                          isSidebarCollapsed && 'lg:sr-only'
                        )}
                      >
                        {item.label}
                      </span>
                    </Button>
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1 overflow-y-auto p-0">{children}</main>
      </div>
    </div>
  );
}
