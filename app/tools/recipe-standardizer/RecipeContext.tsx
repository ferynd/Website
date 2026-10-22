/* --- CONFIGURATION: auth copy --- */
/** Authenticated recipe services and list metadata. Revision-aware writes stay atomic. */
'use client';

const MESSAGE_COPY = {
  outsideProvider: 'useRecipeTool must be used within RecipeProvider',
  mustBeSignedIn: 'You must be signed in.',
  loading: 'Loading…',
  authenticationFailed: 'Authentication failed.',
} as const;

const AUTH_TITLE = 'Log in to Recipe Standardizer';
const AUTH_SUBTITLE = 'Recipes are saved privately to your account.';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import AuthForm from '../trip-cost/components/AuthForm';
import { auth } from './lib/firebase';
import {
  deleteRecipe,
  exportRecipeFood,
  fetchFoodItems,
  createFoodItemsIfAbsent,
  loadRecipe,
  saveNewRecipe,
  updateRecipe,
  watchRecipeList,
} from './lib/db';
import type { LoadRecipeResult, RecipeUpdateResult } from './lib/recipeRevision';
import type { ExportCommitRequest } from './lib/nutritionExport';
import type { Recipe, SavedRecipeMeta } from './lib/types';
import type { LinkTarget, TrackerFood, TrackerFoodDoc } from './lib/trackerFoods';

interface RecipeContextValue {
  user: User | null;
  authLoading: boolean;
  savedRecipes: SavedRecipeMeta[];
  listError: string | null;
  /** True after the first success or error callback for the current user. */
  listLoaded: boolean;
  signOut: () => Promise<void>;
  loadSavedRecipe: (recipeId: string) => Promise<LoadRecipeResult>;
  saveNew: (recipe: Recipe) => Promise<string>;
  update: (recipeId: string, recipe: Recipe, expectedRevision: number) => Promise<RecipeUpdateResult>;
  remove: (recipeId: string) => Promise<void>;
  loadFoodItems: () => Promise<TrackerFood[]>;
  createFoodItems: (docs: {
    id: string;
    data: TrackerFoodDoc;
  }[], guardIds?: string[], linkTargets?: LinkTarget[]) => Promise<void>;
  /** Export and link one tracker food with an atomic transaction. */
  exportFood: (request: ExportCommitRequest) => Promise<void>;
}

const RecipeContext = createContext<RecipeContextValue | undefined>(undefined);

/** Read recipe services. Throws when rendered outside RecipeProvider. */
export const useRecipeTool = (): RecipeContextValue => {
  const ctx = useContext(RecipeContext);
  if (!ctx) throw new Error(MESSAGE_COPY.outsideProvider);
  return ctx;
};

/** Provide authenticated recipe services to the standardizer tree. */
export function RecipeProvider({ children }: {
  children: ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [savedRecipes, setSavedRecipes] = useState<SavedRecipeMeta[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    setListLoaded(false);
    setListError(null);
    setSavedRecipes([]);
    if (!user) {
      setSavedRecipes([]);
      return;
    }
    const unsub = watchRecipeList(user.uid, (metas, error) => {
      setListLoaded(true);
      setSavedRecipes(metas);
      setListError(error ? `Could not load saved recipes: ${error.message}` : null);
    });
    return unsub;
  }, [user]);

  const requireUid = useCallback((): string => {
    if (!user) throw new Error(MESSAGE_COPY.mustBeSignedIn);
    return user.uid;
  }, [user]);

  const value: RecipeContextValue = {
    user,
    authLoading,
    savedRecipes,
    listError,
    listLoaded,
    signOut: useCallback(() => firebaseSignOut(auth), []),
    loadSavedRecipe: useCallback((recipeId: string) => loadRecipe(requireUid(), recipeId), [requireUid]),
    saveNew: useCallback((recipe: Recipe) => saveNewRecipe(requireUid(), recipe), [requireUid]),
    update: useCallback(
      (recipeId: string, recipe: Recipe, expectedRevision: number) =>
        updateRecipe(requireUid(), recipeId, recipe, expectedRevision),
      [requireUid],
    ),
    remove: useCallback((recipeId: string) => deleteRecipe(requireUid(), recipeId), [requireUid]),
    loadFoodItems: useCallback(() => fetchFoodItems(requireUid()), [requireUid]),
    createFoodItems: useCallback(
      (
        docs: { id: string; data: TrackerFoodDoc }[],
        guardIds: string[] = [],
        linkTargets: LinkTarget[] = [],
      ) => createFoodItemsIfAbsent(requireUid(), docs, guardIds, linkTargets),
      [requireUid],
    ),
    exportFood: useCallback(
      (request: ExportCommitRequest) => exportRecipeFood(requireUid(), request),
      [requireUid],
    ),
  };

  return <RecipeContext.Provider value={value}>{children}</RecipeContext.Provider>;
}

/** Renders the shared AuthForm until a user is signed in. */
export function RecipeAuthGate({ children }: {
  children: ReactNode;
}) {
  const { user, authLoading } = useRecipeTool();
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastInitial, setLastInitial] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [authError, setAuthError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setAuthError('');
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        const displayName = `${firstName.trim()} ${lastInitial.trim()}`.trim();
        if (displayName) await updateProfile(cred.user, { displayName });
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : MESSAGE_COPY.authenticationFailed);
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-dvh bg-bg flex items-center justify-center text-text-2">
        {MESSAGE_COPY.loading}</div>
    );
  }

  if (!user) {
    return (
      <AuthForm
        authEmail={authEmail}
        authPassword={authPassword}
        firstName={firstName}
        lastInitial={lastInitial}
        isLogin={isLogin}
        authError={submitting ? '' : authError}
        onSubmit={handleSubmit}
        setAuthEmail={setAuthEmail}
        setAuthPassword={setAuthPassword}
        setFirstName={setFirstName}
        setLastInitial={setLastInitial}
        toggleMode={() => setIsLogin((v) => !v)}
        title={AUTH_TITLE}
        subtitle={AUTH_SUBTITLE}
      />
    );
  }

  return <>{children}</>;
}
