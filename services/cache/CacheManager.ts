// services/CacheManager.ts

interface CacheData {
    [key: string]: any;
  }
  
  class CacheManager {
    private static instance: CacheManager;
    private cache: CacheData = {};
  
    private constructor() {}
  
    public static getInstance(): CacheManager {
      if (!CacheManager.instance) {
        CacheManager.instance = new CacheManager();
      }
      return CacheManager.instance;
    }
  
    public get(key: string): any {
      return this.cache[key];
    }
  
    public set(key: string, value: any): void {
      this.cache[key] = value;
    }
  
    public clear(): void {
      this.cache = {};
    }
  
    public getAll(): CacheData {
      return this.cache;
    }
  }
  
  export default CacheManager;
  