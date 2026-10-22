'use client';

import {
  BarChart3, BookOpen, Bot, Briefcase, Building2, CalendarDays, Clock, CreditCard, FileSpreadsheet, FileText, GraduationCap, HandCoins,
  Handshake, Heart, HeartPulse, House, IdCard, Inbox, Laptop, LifeBuoy, ListChecks, LogOut, Mail, Megaphone, MessagesSquare, Receipt, Scale, ScrollText, Settings,
  ShieldAlert, Sparkles, Timer, TreePalm, Trophy, User, UserCog, UserPlus, Users, Wallet, Workflow, type LucideIcon,
} from 'lucide-react';
import type { IconKey } from './nav-model';

export const NAV_ICONS: Record<IconKey, LucideIcon> = {
  home: House, inbox: Inbox, users: Users, building: Building2, 'user-plus': UserPlus, briefcase: Briefcase,
  'log-out': LogOut, clock: Clock, palm: TreePalm, wallet: Wallet, receipt: Receipt, card: CreditCard, trophy: Trophy,
  graduation: GraduationCap, megaphone: Megaphone, lifebuoy: LifeBuoy, book: BookOpen, file: FileText,
  shield: ShieldAlert, laptop: Laptop, sparkles: Sparkles, chart: BarChart3, 'user-cog': UserCog, workflow: Workflow,
  bot: Bot, scroll: ScrollText, user: User, mail: Mail, sheet: FileSpreadsheet, coins: HandCoins, 'heart-pulse': HeartPulse,
  timer: Timer, calendar: CalendarDays, 'id-card': IdCard, handshake: Handshake, scale: Scale, settings: Settings, heart: Heart,
  messages: MessagesSquare, 'list-checks': ListChecks,
};
