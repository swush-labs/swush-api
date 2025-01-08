import CacheManager from '../CacheManager';

describe('CacheManager', () => {
    let cacheManager: CacheManager;

    beforeEach(() => {
        cacheManager = CacheManager.getInstance();
        cacheManager.clear();
    });

    it('should be a singleton', () => {
        const instance1 = CacheManager.getInstance();
        const instance2 = CacheManager.getInstance();
        expect(instance1).toBe(instance2);
    });

    it('should set and get values', () => {
        cacheManager.set('testKey', 'testValue');
        expect(cacheManager.get('testKey')).toBe('testValue');
    });

    it('should clear all values', () => {
        cacheManager.set('key1', 'value1');
        cacheManager.set('key2', 'value2');
        cacheManager.clear();
        expect(cacheManager.getAll()).toEqual({});
    });

    it('should return all cached values', () => {
        cacheManager.set('key1', 'value1');
        cacheManager.set('key2', 'value2');
        expect(cacheManager.getAll()).toEqual({
            key1: 'value1',
            key2: 'value2'
        });
    });
}); 