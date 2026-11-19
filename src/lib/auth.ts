import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { prisma } from './prisma';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase() ?? '';
      const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();
      if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
        return false; // Tolak login di luar domain korporat
      }

      const dbUser = await prisma.user.upsert({
        where: { email },
        update: { name: user.name ?? email, image: user.image ?? null },
        create: {
          email,
          name: user.name ?? email.split('@')[0],
          image: user.image ?? null,
          role: 'EDITOR',
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: dbUser.id,
          actorEmail: email,
          action: 'LOGIN',
          targetType: 'Session',
          targetId: dbUser.id,
          detail: 'Google OAuth Login berhasil',
        },
      });
      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({ where: { email: user.email.toLowerCase() } });
        if (dbUser) {
          token.role = dbUser.role;
          token.department = dbUser.department;
          token.uid = dbUser.id;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as Record<string, unknown>).role = token.role ?? 'EDITOR';
        (session.user as Record<string, unknown>).department = token.department ?? 'Operations';
        (session.user as Record<string, unknown>).id = token.uid ?? '';
      }
      return session;
    },
  },
};
