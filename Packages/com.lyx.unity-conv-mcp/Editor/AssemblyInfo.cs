using System.Runtime.CompilerServices;

// Editor-only test suite exercises internal helpers (BridgeSettings token, etc.)
// against the real EditorBridgeServer listener.
[assembly: InternalsVisibleTo("Lyx.UnityConvMcp.Tests.Editor")]
