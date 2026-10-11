import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Modules that build the API client read this at import; tests stub `fetch`, so nothing is called.
vi.stubEnv("VITE_API_BASE_URL", "http://api.test");

afterEach(cleanup);
