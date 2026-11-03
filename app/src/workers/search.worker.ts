// STUB (M0) → T-DOCS: owns one PassageIndex per class and answers the IndexHost messages
// (architecture §11.7). Until then every method replies NOT_IMPLEMENTED; the app uses createInlineHost().
import { serveRpc } from './rpc';

serveRpc(self as unknown as Parameters<typeof serveRpc>[0], {});
