// --- Configuration ---
// File: ferynd/website/Website-9d47f1d03f7de6e216c42f764fa46dd0ff378b1f/app/tools/shows/ShowsContext.tsx
// ---------------------

'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signOut as firebaseSignOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  Timestamp,
} from 'firebase/firestore';
import { auth } from './lib/db';
import {
  listsCol,
  listDoc,
  showsCol,
  showDoc,
  pendingInvitesCol,
} from './lib/firestore';
import type { ShowList, Show, ListMember, MemberRating, UserProfile } from './types';

interface ShowsContextValue {
  user: User | null;
  userProfile: UserProfile | null;
  authLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  logOut: () => Promise<void>;
  lists: ShowList[];
  activeList: ShowList | null;
  setActiveListId: (id: string) => void;
  createList: (name: string) => Promise<string>;
  renameList: (listId: string, name: string) => Promise<void>;
  deleteList: (listId: string) => Promise<void>;
  addMember: (listId: string, email: string) => Promise<void>;
  removeMember: (listId: string, uid: string) => Promise<void>;
  promoteToAdmin: (listId: string, uid: string) => Promise<void>;
  leaveList: (listId: string) => Promise<void>;
  shows: Show[];
  showsLoading: boolean;
  addShow: (
    data: Omit<Show, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'lastEditedBy'>,
  ) => Promise<string>;
  updateShow: (
    showId: string,
    data: Partial<Omit<Show, 'id' | 'createdAt' | 'createdBy'>>,
  ) => Promise<void>;
  deleteShow: (showId: string) => Promise<void>;
  updateMyRating: (showId: string, rating: Partial<MemberRating>) => Promise<void>;
}

const ShowsContext = createContext<ShowsContextValue | null>(null);

export function ShowsProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [lists, setLists] = useState<ShowList[]>([]);
  const [activeListId, setActiveListIdRaw] = useState<string | null>(null);
  const [shows, setShows] = useState<Show[]>([]);
  const [showsLoading, setShowsLoading] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        setUserProfile({
          uid: u.uid,
          email: u.email ?? '',
          displayName: u.displayName ?? u.email ?? '',
        });
        processPendingInvites(u).catch(() => {});
      } else {
        setUserProfile(null);
        setLists([]);
        setShows([]);
        setActiveListIdRaw(null);
      }
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  // Watch for new pending invites while already signed in and process them immediately.
  // Without this, invites created after sign-in aren't consumed until the next sign-in.
  useEffect(() => {
    if (!user?.email) return;
    const email = user.email.toLowerCase();
    const q = query(pendingInvitesCol(), where('email', '==', email));
    const unsub = onSnapshot(q, async (snap) => {
      if (snap.empty) return;
      for (const inviteSnap of snap.docs) {
        const invite = inviteSnap.data();
        const lRef = listDoc(invite.listId);
        try {
          const listSnap = await getDoc(lRef);
          if (!listSnap.exists()) { await deleteDoc(inviteSnap.ref); continue; }
          const listData = listSnap.data() as ShowList;
          if (listData.memberUids?.includes(user.uid)) { await deleteDoc(inviteSnap.ref); continue; }
          const member: ListMember = {
            uid: user.uid,
            email: user.email ?? '',
            displayName: user.displayName ?? user.email ?? '',
            role: 'member',
            joinedAt: Timestamp.now(),
          };
          await updateDoc(lRef, {
            members: arrayUnion(member),
            memberUids: arrayUnion(user.uid),
            updatedAt: serverTimestamp(),
          });
          await deleteDoc(inviteSnap.ref);
        } catch { }
      }
    });
    return unsub;
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const q = query(listsCol(), where('memberUids', 'array-contains', user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const ls = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ShowList);
      setLists(ls);
      const stored = typeof window !== 'undefined' ? localStorage.getItem('shows-active-list') : null;
      setActiveListIdRaw((prev) => {
        if (prev && ls.some((l) => l.id === prev)) return prev;
        if (stored && ls.some((l) => l.id === stored)) return stored;
        return ls[0]?.id ?? null;
      });
    }, (error) => {
      console.error("Lists listener failed:", error);
    });
    return unsub;
  }, [user]);

  useEffect(() => {
    if (!activeListId) {
      setShows([]);
      return;
    }
    setShowsLoading(true);
    const q = query(
      showsCol(),
      where('listId', '==', activeListId),
      orderBy('updatedAt', 'desc'),
    );
    // Added explicit error handling to prevent infinite spinner if index is missing
    const unsub = onSnapshot(q, 
      (snap) => {
        setShows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Show));
        setShowsLoading(false);
      },
      (error) => {
        console.error("Shows listener failed. Check if a composite index is missing:", error);
        setShowsLoading(false);
      }
    );
    return unsub;
  }, [activeListId]);

  const setActiveListId = useCallback((id: string) => {
    setActiveListIdRaw(id);
    if (typeof window !== 'undefined') {
      localStorage.setItem('shows-active-list', id);
    }
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });
    setUserProfile({ uid: cred.user.uid, email, displayName });
  }, []);

  const logOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  const createList = useCallback(async (name: string): Promise<string> => {
    if (!user || !userProfile) throw new Error('Not signed in');
    const member: ListMember = {
      uid: user.uid,
      email: user.email ?? '',
      displayName: userProfile.displayName,
      role: 'admin',
      joinedAt: Timestamp.now(),
    };
    const ref = await addDoc(listsCol(), {
      name,
      ownerId: user.uid,
      members: [member],
      memberUids: [user.uid],
      adminUids: [user.uid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setActiveListId(ref.id);
    return ref.id;
  }, [user, userProfile, setActiveListId]);

  const renameList = useCallback(async (listId: string, name: string) => {
    await updateDoc(listDoc(listId), { name, updatedAt: serverTimestamp() });
  }, []);

  const deleteList = useCallback(async (listId: string) => {
    const q = query(showsCol(), where('listId', '==', listId));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(listDoc(listId));
  }, []);

  const addMember = useCallback(async (listId: string, email: string) => {
    if (!user) throw new Error('Not signed in');
    await addDoc(pendingInvitesCol(), {
      email: email.toLowerCase().trim(),
      listId,
      invitedBy: user.uid,
      createdAt: serverTimestamp(),
    });
  }, [user]);

  const removeMember = useCallback(async (listId: string, uid: string) => {
    const list = lists.find((l) => l.id === listId);
    if (!list) return;
    const updatedMembers = list.members.filter((m) => m.uid !== uid);
    await updateDoc(listDoc(listId), {
      members: updatedMembers,
      memberUids: arrayRemove(uid),
      adminUids: arrayRemove(uid),
      updatedAt: serverTimestamp(),
    });
  }, [lists]);

  const promoteToAdmin = useCallback(async (listId: string, uid: string) => {
    const list = lists.find((l) => l.id === listId);
    if (!list) return;
    const updatedMembers = list.members.map((m) =>
      m.uid === uid ? { ...m, role: 'admin' as const } : m,
    );
    await updateDoc(listDoc(listId), {
      members: updatedMembers,
      adminUids: arrayUnion(uid),
      updatedAt: serverTimestamp(),
    });
  }, [lists]);

  const leaveList = useCallback(async (listId: string) => {
    if (!user) return;
    await removeMember(listId, user.uid);
    if (activeListId === listId) {
      const remaining = lists.filter((l) => l.id !== listId);
      if (remaining[0]) setActiveListId(remaining[0].id);
      else setActiveListIdRaw(null);
    }
  }, [user, activeListId, lists, removeMember, setActiveListId]);

  const addShow = useCallback(async (data: Omit<Show, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'lastEditedBy'>): Promise<string> => {
    if (!user) throw new Error('Not signed in');
    const ref = await addDoc(showsCol(), {
      ...data,
      createdBy: user.uid,
      lastEditedBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  }, [user]);

  const updateShow = useCallback(async (showId: string, data: Partial<Omit<Show, 'id' | 'createdAt' | 'createdBy'>>) => {
    if (!user) return;
    await updateDoc(showDoc(showId), {
      ...data,
      lastEditedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
  }, [user]);

  const deleteShow = useCallback(async (showId: string) => {
    await deleteDoc(showDoc(showId));
  }, []);

  const updateMyRating = useCallback(async (showId: string, rating: Partial<MemberRating>) => {
    if (!user) return;
    const show = shows.find((s) => s.id === showId);
    const existing: MemberRating = show?.ratings[user.uid] ?? {
      story: null, characters: null, vibes: null, wouldRewatch: null, ratedAt: null,
    };
    await updateDoc(showDoc(showId), {
      [`ratings.${user.uid}`]: { ...existing, ...rating, ratedAt: serverTimestamp() },
      lastEditedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
  }, [user, shows]);

  const activeList = lists.find((l) => l.id === activeListId) ?? null;

  return (
    <ShowsContext.Provider
      value={{
        user, userProfile, authLoading, signIn, signUp, logOut,
        lists, activeList, setActiveListId, createList, renameList, deleteList,
        addMember, removeMember, promoteToAdmin, leaveList,
        shows, showsLoading, addShow, updateShow, deleteShow, updateMyRating,
      }}
    >
      {children}
    </ShowsContext.Provider>
  );
}

export function useShows() {
  const ctx = useContext(ShowsContext);
  if (!ctx) throw new Error('useShows must be used within ShowsProvider');
  return ctx;
}

async function processPendingInvites(u: User) {
  if (!u.email) return;
  const email = u.email.toLowerCase();
  const q = query(pendingInvitesCol(), where('email', '==', email));
  let snap;
  try { snap = await getDocs(q); } catch { return; }
  for (const inviteSnap of snap.docs) {
    const invite = inviteSnap.data();
    const lRef = listDoc(invite.listId);
    try {
      const listSnap = await getDoc(lRef);
      if (!listSnap.exists()) { await deleteDoc(inviteSnap.ref); continue; }
      const listData = listSnap.data() as ShowList;
      if (listData.memberUids?.includes(u.uid)) { await deleteDoc(inviteSnap.ref); continue; }
      const member: ListMember = {
        uid: u.uid,
        email: u.email ?? '',
        displayName: u.displayName ?? u.email ?? '',
        role: 'member',
        joinedAt: Timestamp.now(),
      };
      await updateDoc(lRef, {
        members: arrayUnion(member),
        memberUids: arrayUnion(u.uid),
        updatedAt: serverTimestamp(),
      });
      await deleteDoc(inviteSnap.ref);
    } catch { }
  }
}
