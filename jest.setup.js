// jest setup file

// mock localStorage
const localStorageMock = {
    store: {},
    getItem: jest.fn((key) => localStorageMock.store[key] || null),
    setItem: jest.fn((key, value) => {
        localStorageMock.store[key] = value;
    }),
    removeItem: jest.fn((key) => {
        delete localStorageMock.store[key];
    }),
    clear: jest.fn(() => {
        localStorageMock.store = {};
    })
};

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock
});

// mock sessionStorage
const sessionStorageMock = {
    store: {},
    getItem: jest.fn((key) => sessionStorageMock.store[key] || null),
    setItem: jest.fn((key, value) => {
        sessionStorageMock.store[key] = value;
    }),
    removeItem: jest.fn((key) => {
        delete sessionStorageMock.store[key];
    }),
    clear: jest.fn(() => {
        sessionStorageMock.store = {};
    })
};

Object.defineProperty(window, 'sessionStorage', {
    value: sessionStorageMock
});

// mock navigator.clipboard
Object.defineProperty(navigator, 'clipboard', {
    value: {
        writeText: jest.fn().mockResolvedValue(undefined),
        readText: jest.fn().mockResolvedValue('')
    }
});

// mock fetch
global.fetch = jest.fn();

// mock AbortController
global.AbortController = class AbortController {
    constructor() {
        this.signal = { aborted: false };
    }
    abort() {
        this.signal.aborted = true;
    }
};

// clear mocks before each test
beforeEach(() => {
    localStorageMock.store = {};
    sessionStorageMock.store = {};
    jest.clearAllMocks();
});
