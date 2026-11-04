import { sampleCurp } from "@/lib/people/identity";

// Above the demo seed's and the IDOR fixtures' indexes, so a test person never
// collides with them; unique within a test file (one module per file).
let next = 10_000 + Math.floor(Math.random() * 100) * 1_000;

/** A valid CURP no other person of the test run has: every active person needs one. */
export const uniqueCurp = () => sampleCurp(next++);
