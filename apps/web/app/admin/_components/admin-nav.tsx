'use client';

import { NavigationLink as Link } from '@/components/navigation-link';
import { usePathname } from 'next/navigation';
import { Bot, Coins, Cpu, Gauge, ListChecks, Server, UserRoundCog, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/admin', label: 'Overview', icon: Gauge },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/accounts', label: 'Accounts', icon: UserRoundCog },
  { href: '/admin/jobs', label: 'Jobs', icon: ListChecks },
  { href: '/admin/pricing', label: 'Pricing', icon: Coins },
  { href: '/admin/models', label: 'Models', icon: Cpu },
  { href: '/admin/system', label: 'System', icon: Server }
];

export function AdminBrand() {
  return (
    <Link href="/admin" className="flex items-center">
      <Bot className="h-6 w-6 text-emerald-600" />
      <span className="ml-2 text-xl font-semibold text-slate-900">Admin</span>
    </Link>
  );
}

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin navigation" className="flex min-w-0 gap-1 overflow-x-auto lg:block">
      {navItems.map((item) => {
        const active =
          pathname === item.href || (item.href !== '/admin' && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-w-max items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors lg:min-w-0',
              active
                ? 'bg-slate-950 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
