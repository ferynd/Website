import type { ReactNode } from 'react';
import { ShowsProvider } from './ShowsContext';
import ShowsAuthGate from './components/ShowsAuthGate';

export const metadata = {
  title: 'Show Tracker',
  description: 'Track shows and movies with your group.',
};

export default function ShowsLayout({ children }: { children: ReactNode }) {
  return (
    <ShowsProvider>
      <ShowsAuthGate>{children}</ShowsAuthGate>
    </ShowsProvider>
  );
}
