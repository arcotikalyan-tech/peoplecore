'use client';

import {
  BarChart3, BookOpen, Bot, Briefcase, Building2, Clock, CreditCard, FileText, GraduationCap, House, Inbox, Laptop,
  LifeBuoy, LogOut, Megaphone, Receipt, ScrollText, ShieldAlert, Sparkles, TreePalm, Trophy, User, UserCog, UserPlus,
  Users, Wallet, Workflow, type LucideIcon,
} from 'lucide-react';
import type { IconKey } from './nav-model';

export const NAV_ICONS: Record<IconKey, LucideIcon> = {
  home: House, inbox: Inbox, users: Users, building: Building2, 'user-plus': UserPlus, briefcase: Briefcase,
  'log-out': LogOut, clock: Clock, palm: TreePalm, wallet: Wallet, receipt: Receipt, card: CreditCard, trophy: Trophy,
  graduation: GraduationCap, megaphone: Megaphone, lifebuoy: LifeBuoy, book: BookOpen, file: FileText,
  shield: ShieldAlert, laptop: Laptop, sparkles: Sparkles, chart: BarChart3, 'user-cog': UserCog, workflow: Workflow,
  bot: Bot, scroll: ScrollText, user: User,
};
