import { collection, doc } from 'firebase/firestore';
import { db } from './db';

const ROOT = 'artifacts';
const APP = 'shows';

export const listsCol = () => collection(db, ROOT, APP, 'lists');
export const listDoc = (id: string) => doc(db, ROOT, APP, 'lists', id);

export const showsCol = () => collection(db, ROOT, APP, 'shows');
export const showDoc = (id: string) => doc(db, ROOT, APP, 'shows', id);

export const pendingInvitesCol = () => collection(db, ROOT, APP, 'pendingInvites');
export const pendingInviteDoc = (id: string) => doc(db, ROOT, APP, 'pendingInvites', id);
