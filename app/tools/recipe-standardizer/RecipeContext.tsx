'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: auth copy                                      */
/* ------------------------------------------------------------ */
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
  fetchFoodItems,
  loadRecipe,
  saveNewRecipe,
  updateRecipe,
  watchRecipeList,
} from './lib/db';
import type { ParseResult } from './lib/schema';
import type { FoodItemRef, Recipe, SavedRecipeMeta } from './lib/types';

interface RecipeContextValue {
  user: User | null;
  authLoading: boolean;
  savedRecipes: SavedRecipeMeta[];
  listError: string | null;
  signOut: () => Promise<void>;
  loadSavedRecipe: (recipeId: string) => Promise<ParseResult>;
  saveNew: (recipe: Recipe) => Promise<string>;
  update: (recipeId: string, recipe: Recipe) => Promise<void>;
  remove: (recipeId: string) => Promise<void>;
  loadFoodItems: () => Promise<FoodItemRef[]>;
}

const RecipeContext = createContext<RecipeContextValue | undefined>(undefined);

export const useRecipeTool = (): RecipeContextValue => {
  const ctx = useContext(RecipeContext);
  if (!ctx) throw new Error('useRecipeTool must be used within RecipeProvider');
  return ctx;
};

export function RecipeProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [savedRecipes, setSavedRecipes] = useState<SavedRecipeMeta[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) {
      setSavedRecipes([]);
      return;
    }
    const unsub = watchRecipeList(user.uid, (metas, error) => {
      setSavedRecipes(metas);
      setListError(error ? `Could not load saved recipes: ${error.message}` : null);
    });
    return unsub;
  }, [user]);

  const requireUid = useCallback((): string => {
    if (!user) throw new Error('You must be signed in.');
    return user.uid;
  }, [user]);

  const value: RecipeContextValue = {
    user,
    authLoading,
    savedRecipes,
    listError,
    signOut: useCallback(() => firebaseSignOut(auth), []),
    loadSavedRecipe: useCallback((recipeId: string) => loadRecipe(requireUid(), recipeId), [requireUid]),
    saveNew: useCallback((recipe: Recipe) => saveNewRecipe(requireUid(), recipe), [requireUid]),
    update: useCallback((recipeId: string, recipe: Recipe) => updateRecipe(requireUid(), recipeId, recipe), [requireUid]),
    remove: useCallback((recipeId: string) => deleteRecipe(requireUid(), recipeId), [requireUid]),
    loadFoodItems: useCallback(() => fetchFoodItems(requireUid()), [requireUid]),
  };

  return <RecipeContext.Provider value={value}>{children}</RecipeContext.Provider>;
}

/** Renders the shared AuthForm until a user is signed in. */
export function RecipeAuthGate({ children }: { children: ReactNode }) {
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
      setAuthError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-dvh bg-bg flex items-center justify-center text-text-2">
        Loading…
      </div>
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
