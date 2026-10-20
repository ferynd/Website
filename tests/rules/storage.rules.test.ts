import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { type RulesTestEnvironment, assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { deleteObject, getMetadata, listAll, ref, uploadBytes } from 'firebase/storage';

// Must match firebase emulators:exec --project: Storage's firestore.get()
// uses the CLI project, not the project inferred from a test's bucket name.
const PROJECT_ID = 'demo-website-rules-test';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0x02]);
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearStorage(); await env.clearFirestore(); });

for (const { tool, parent, folder } of [
  { tool: 'Date Night', parent: 'artifacts/date-night/couples/main', folder: 'artifacts/date-night/uploads/roll1' },
  { tool: 'Trip Planner', parent: 'artifacts/trip-planner/planners/planner1', folder: 'artifacts/trip-planner/uploads/planner1/dedupe' },
]) {
  describe(`${tool}: actual cross-service authorization`, () => {
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), parent), { ownerUid: 'participant', participantUids: ['participant'] });
      });
    });
    const object = (uid = 'participant') => ref(env.authenticatedContext(uid).storage(), `${folder}/photo.jpg`);

    it('allows participant upload, read and replacement', async () => {
      const target = object();
      await assertSucceeds(uploadBytes(target, JPEG, { contentType: 'image/jpeg' }));
      expect((await getMetadata(target)).size).toBe(JPEG.length);
      await assertSucceeds(uploadBytes(target, JPEG, { contentType: 'image/webp' }));
      expect((await getMetadata(target)).contentType).toBe('image/webp');
    });
    it('allows list/getMetadata/deleteObject used by PlanContext image cleanup', async () => {
      const target = object();
      await uploadBytes(target, JPEG, { contentType: 'image/jpeg' });
      const listing = await assertSucceeds(listAll(ref(target.storage, folder)));
      expect(listing.items).toHaveLength(1);
      for (const item of listing.items) {
        await assertSucceeds(getMetadata(item));
        await assertSucceeds(deleteObject(item));
      }
      await expect(getMetadata(target)).rejects.toMatchObject({ code: 'storage/object-not-found' });
    });
    it('denies outsider creation, read, replacement and deletion; preserves the object', async () => {
      const target = object();
      await uploadBytes(target, JPEG, { contentType: 'image/jpeg' });
      const outsider = object('outsider');
      await assertFails(uploadBytes(ref(outsider.storage, `${folder}/new.jpg`), JPEG, { contentType: 'image/jpeg' }));
      await assertFails(getMetadata(outsider));
      await assertFails(uploadBytes(outsider, JPEG, { contentType: 'image/jpeg' }));
      await assertFails(deleteObject(outsider));
      expect((await getMetadata(target)).size).toBe(JPEG.length);
    });
    it('denies signed-out upload and deletion', async () => {
      await uploadBytes(object(), JPEG, { contentType: 'image/jpeg' });
      const target = ref(env.unauthenticatedContext().storage(), `${folder}/photo.jpg`);
      await assertFails(uploadBytes(target, JPEG, { contentType: 'image/jpeg' }));
      await assertFails(deleteObject(target));
    });
    it('rejects the size ceiling and disallowed MIME types for an authorized participant', async () => {
      const target = object();
      await assertSucceeds(uploadBytes(target, JPEG, { contentType: 'image/jpeg' }));
      await assertFails(uploadBytes(target, new Uint8Array(8 * 1024 * 1024), { contentType: 'image/jpeg' }));
      for (const contentType of ['text/html', 'image/svg+xml', 'application/octet-stream']) {
        await assertFails(uploadBytes(target, JPEG, { contentType }));
      }
      expect((await getMetadata(target)).contentType).toBe('image/jpeg');
    });
    it('preserves verified admin read/delete authority but enforces upload limits', async () => {
      await uploadBytes(object(), JPEG, { contentType: 'image/jpeg' });
      const admin = env.authenticatedContext('admin', { email: 'arkkahdarkkahd@gmail.com', email_verified: true });
      const target = ref(admin.storage(), `${folder}/photo.jpg`);
      await assertSucceeds(getMetadata(target));
      await assertFails(uploadBytes(target, JPEG, { contentType: 'text/html' }));
      await assertSucceeds(deleteObject(target));
      await assertSucceeds(uploadBytes(target, JPEG, { contentType: 'image/png' }));
    });
    it('denies unverified admin deletion', async () => {
      await uploadBytes(object(), JPEG, { contentType: 'image/jpeg' });
      const admin = env.authenticatedContext('admin', { email: 'arkkahdarkkahd@gmail.com', email_verified: false });
      await assertFails(deleteObject(ref(admin.storage(), `${folder}/photo.jpg`)));
    });
  });
}
it('denies uploads to an unmatched namespace', async () => {
  await assertFails(uploadBytes(ref(env.authenticatedContext('participant').storage(), 'other/file.jpg'), JPEG, { contentType: 'image/jpeg' }));
});
