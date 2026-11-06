export interface IngredientTransaction {
    get(ref: unknown): Promise<Record<string, any> | null>;
    set(ref: unknown, data: Record<string, any>): void;
    update(ref: unknown, data: Record<string, any>): void;
}
export interface IngredientFirestorePort {
    docRef(path: string): unknown;
    getDoc(ref: unknown): Promise<Record<string, any> | null>;
    runTransaction<T>(fn: (tx: IngredientTransaction) => Promise<T>): Promise<T>;
    queryCollection(path: string, options: {
        arrayContains?: [
            string,
            string
        ];
        equals?: [
            string,
            string
        ];
        orderById: boolean;
        limit: number;
        startAfterId?: string;
    }): Promise<Array<Record<string, any> & {
        id: string;
    }>>;
    serverTimestamp(): any;
}
