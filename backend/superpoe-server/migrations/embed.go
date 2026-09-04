package migrations

import "embed"

// FS is embedded into the server binary so deployments do not depend on files
// being copied or edited on the target machine.
//
//go:embed *.sql
var FS embed.FS
