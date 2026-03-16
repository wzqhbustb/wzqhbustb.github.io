# Chapter 1: Design Philosophy and Core Concepts

> **Source Document**: Lance File Format Deep Analysis and Implementation Guide (Complete Version)  
> **Chapter**: Chapter 1 - Design Philosophy and Core Concepts  
> **Translated from**: Chinese  
> **Translation Date**: 2026-03-16

---

## 1.1 Minimalist Design

The core design philosophy of the Lance file format is **extreme separation of concerns**:

> "The Lance file format does not have any notion of a type system or schemas. From the perspective of the file format all data is arbitrary buffers of bytes with an extensible metadata block to describe the data."
> 
> —— `file2.proto`

**Key Principles**:

| Principle | Description | Advantages |
| --------- | ----------- | ---------- |
| **Type-less Format Layer** | The format layer does not define a type system; relies on Arrow Schema in FileDescriptor (Global Buffer #0) to interpret data semantics | Decouples format from types, supports flexible evolution |
| **Data as Bytes** | From the file format perspective, all data is simply "arbitrary buffers of bytes" | Encoding strategies are completely independent |
| **Pluggable Encoding** | Encoders/decoders are added through a plugin system without recompilation | Highly extensible |
| **Random Access First** | All design decisions serve efficient random reads | Low-latency queries |

---

## 1.2 Comparison with Parquet/ORC

| Feature | Parquet | ORC | Lance |
|---------|---------|-----|-------|
| **Type System** | ✅ Thrift-defined | ✅ Protobuf-defined | ❌ None (relies on Arrow) |
| **Schema Location** | File Footer | File Footer | Global Buffer #0 |
| **Encoding Extension** | ❌ Requires format spec changes | ❌ Requires format spec changes | ✅ Plugin system |
| **Design Goal** | Batch analytics | Hive optimization | Random access + Analytics |
| **Nested Support** | Rep-Def Levels | Similar to Parquet | Rep-Def + Full Zip |
| **Random Access** | ⚠️ Page-level index | ⚠️ Limited | ✅ Repetition Index (2 IOPS) |

---

## Key Takeaways

1. **Separation of Concerns**: Lance separates the file format layer from the type system, enabling independent evolution of both.

2. **Arrow-Native**: Rather than defining its own type system, Lance leverages Apache Arrow's rich type ecosystem through Global Buffer #0.

3. **Plugin Architecture**: The encoding system is designed for extensibility, allowing new compression algorithms and encodings without format changes.

4. **Random Access Optimization**: Unlike Parquet and ORC which optimize for sequential scans, Lance prioritizes low-latency random access through innovative structures like the Repetition Index.

---

## Chapter 2: Module Architecture and Layer Relationships

### 2.1 Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  lance-file (File Format Layer)                                 │
│  Source: rust/lance-file/src/                                   │
│  - Responsibilities: File layout, page management, Footer,      │
│    global buffers, version management                           │
│  - Not aware of: Specific encoding algorithms                   │
├─────────────────────────────────────────────────────────────────┤
│  lance-encoding (Encoding Layer)                                │
│  Source: rust/lance-encoding/src/                               │
│  - Responsibilities: Full Zip / Mini-block, compression,        │
│    Rep-Def Levels                                               │
│  - Provides: FieldEncoder / PageEncoding trait                  │
├─────────────────────────────────────────────────────────────────┤
│  lance-io (I/O Layer)                                           │
│  Source: rust/lance-io/src/                                     │
│  - Responsibilities: Object storage abstraction, I/O scheduling,│
│    caching                                                      │
└─────────────────────────────────────────────────────────────────┘
```

Data flows through the system as follows: first encoded by lance-encoding, then organized into file structures by lance-file, and finally written physically through lance-io.

### 2.2 File Format Layer Responsibility Boundaries

| Responsibility | Description | Source Location |
| -------------- | ----------- | --------------- |
| ✅ Manage file structure and metadata locations | Read/write Footer, CMO, GBO tables | `reader.rs`, `writer.rs` |
| ✅ Coordinate encoder writing | Call FieldEncoder, collect page metadata | `writer.rs:207` |
| ✅ Version management | Support read/write for v2.0 to v2.3 | `lib.rs`, `version.rs` |
| ❌ Do not implement specific encoding algorithms | Delegate to lance-encoding | - |
| ❌ Do not handle I/O scheduling details | Delegate to lance-io | - |

---

## Architecture Insights

The three-layer architecture demonstrates excellent **separation of concerns**:

1. **lance-encoding** focuses purely on data transformation (encoding/decoding)
2. **lance-file** handles the file format structure and metadata management
3. **lance-io** abstracts storage operations and optimizes I/O patterns

This design allows each layer to evolve independently while maintaining clean interfaces between them.

---

## Chapter 3: Relationship Between File Format and Table Format

### 3.1 Architecture Layers

The Lance storage engine is divided into two layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Table Format                                 │
│  Source: lance-table crate                                      │
│  - Manifest management (versions, schema evolution, transactions)│
│  - Dataset abstraction                                          │
│  - MVCC (Multi-Version Concurrency Control)                     │
│  - Index management (IVF, HNSW, etc.)                           │
├─────────────────────────────────────────────────────────────────┤
│                    File Format ← Focus of this document         │
│  Source: lance-file, lance-encoding crates                      │
│  - Physical layout of individual .lance files                   │
│  - Encoding/decoding algorithms                                 │
│  - Page management, Footer, global buffers                      │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Relationship Between Manifest and Data Files

**Table Directory Structure**:

```
table_path/
├── _versions/
│   ├── 1.manifest          # Metadata for version 1
│   ├── 2.manifest          # Metadata for version 2
│   └── ...
├── _indices/               # Index file directory
│   └── {index_uuid}/
│       └── index.lance
└── data/
    ├── 0.lance             # Data file 0
    ├── 1.lance             # Data file 1
    └── ...
```

**Manifest Content** (JSON / Protobuf):

```protobuf
message Manifest {
  uint64 version = 1;                    # Version number (incremental)
  Schema schema = 2;                     # Current Schema (Arrow)
  repeated DataFragment fragments = 3;   # List of data fragments
  repeated IndexMetadata indices = 4;    # List of indexes
  uint64 num_rows = 5;                   # Total number of rows
}

message DataFragment {
  uint64 id = 1;                         # Fragment ID
  repeated DataFile files = 2;           # Included data files
  uint64 num_rows = 3;                   # Number of rows in fragment
}

message DataFile {
  string path = 1;                       # .lance file path
  repeated int32 column_indices = 2;     # Included column indices
  uint64 num_rows = 3;                   # Number of rows in file
}
```

**Relationship Description**:

| Concept | Layer | Purpose | Visible to File Format Layer? |
|---------|-------|---------|------------------------------|
| **Manifest** | Table Format | Manages table versions, schema evolution, transaction isolation | ❌ No |
| **DataFragment** | Table Format | Organizes multiple .lance files into logical fragments | ❌ No |
| **.lance file** | File Format | Stores actual column data, page metadata | ✅ Yes |
| **Page** | File Format | Basic unit for data organization and I/O | ✅ Yes |

### 3.3 Write Transaction Flow

```rust
// Table level: Adding new data (Dataset::append)
async fn append(dataset: &Dataset, batch: RecordBatch) -> Result<()> {
    // 1. Write new .lance file (file format layer)
    let new_file_path = format!("data/{}.lance", generate_id());
    let mut writer = FileWriter::open(&new_file_path).await?;
    writer.write(batch).await?;
    writer.finish().await?;
    
    // 2. Update Manifest (table format layer)
    let mut manifest = dataset.current_manifest().clone();
    manifest.version += 1;
    manifest.fragments.push(DataFragment {
        id: manifest.fragments.len() as u64,
        files: vec![DataFile {
            path: new_file_path,
            column_indices: (0..batch.num_columns()).collect(),
            num_rows: batch.num_rows() as u64,
        }],
        num_rows: batch.num_rows() as u64,
    });
    manifest.num_rows += batch.num_rows() as u64;
    
    // 3. Atomically write new Manifest
    write_manifest_atomic(&manifest).await?;
    
    Ok(())
}
```

**Complete Write Transaction Flow**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Table Format Layer (lance-table)                │
│                         Transaction Coordination + Manifest Management  │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  1. Transaction Begin                                                    │
│     - Get snapshot of current Manifest (as base_version)                │
│     - Check schema compatibility (whether evolution is needed)          │
│     - Allocate new transaction ID                                        │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  2. Prepare Write                                                        │
│     - Assign fragment_id for RecordBatch                                │
│     - Generate .lance file path: data/{uuid}.lance                      │
│     - Create FileWriter (file format layer)                             │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      File Format Layer (lance-file/lance-encoding)      │
│                         Actual Data Encoding and Writing                │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  3. Data Encoding (lance-encoding)                                      │
│                                                                             │
│     RecordBatch ──► BatchEncoder ──► FieldEncoder ──► EncodedBatch       │
│        │                │                │                                 │
│        │                ▼                │                                 │
│        │         Logical Encoding: Arrow Array ──► DataBlock              │
│        │                │                │                                 │
│        │                ▼                │                                 │
│        │         Physical Encoding: DataBlock ──► Mini-block/Full Zip     │
│        │                │                │                                 │
│        │                ▼                │                                 │
│        │         Compression: BitPacking/FSST/Zstd etc.                   │
│        │                                                                 │
│     Output: Page (encoded data block, default 8MB)                        │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  4. Page Management (lance-file)                                        │
│                                                                             │
│     For each column:                                                     │
│     - Accumulate data to page buffer (default 8MB/column)               │
│     - When page is full:                                                 │
│       a) Allocate file offset (64-byte aligned)                         │
│       b) Write to Data Section                                          │
│       c) Record PageMetadata (offset, size, row count, encoding)        │
│       d) Clear buffer, continue to next page                            │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  5. Complete Data Write (FileWriter::finish)                            │
│                                                                             │
│     Write to end of file in order:                                      │
│     ┌─────────────────────────────────────────────────────────────────┐ │
│     │  [1] Global Buffers (Schema/Dictionary)                         │ │
│     │  [2] Column Metadata (Page list per column, encoding info)     │ │
│     │  [3] CMO Table (Column Metadata Offset Table)                  │ │
│     │  [4] GBO Table (Global Buffer Offset Table)                    │ │
│     │  [5] Footer (40 bytes: offsets to above regions)               │ │
│     │  [6] Magic (4 bytes: "LANC")                                   │ │
│     └─────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│     Return: ColumnMetadata list (for updating Manifest)                   │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Table Format Layer (lance-table)                │
│                         Transaction Commit                              │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  6. Build New Manifest                                                   │
│                                                                             │
│     Create new Manifest based on base_version:                          │
│     - version = base_version + 1                                        │
│     - schema (update if evolved)                                        │
│     - fragments: Copy all fragments from base + new fragment            │
│                                                                             │
│     New Fragment:                                                        │
│     {                                                                     │
│       id: fragment_id,                                                  │
│       files: [{                                                          │
│         path: "data/{uuid}.lance",                                      │
│         column_indices: [0, 1, 2, ...],                                 │
│         num_rows: batch.num_rows()                                      │
│       }],                                                                 │
│       num_rows: batch.num_rows()                                        │
│     }                                                                     │
│                                                                             │
│     - num_rows += batch.num_rows()                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  7. Atomic Commit (Critical Point)                                      │
│                                                                             │
│     write_manifest_atomic(&manifest):                                   │
│                                                                             │
│     a) Write to temp file: _versions/{version}.manifest.tmp             │
│     b) Atomic rename: .tmp ──► {version}.manifest                       │
│        (object store's put-if-absent or filesystem rename)              │
│     c) Update latest manifest pointer (atomic operation)                │
│                                                                             │
│     Transaction is now committed, new version visible to other readers  │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  8. Cleanup (Async)                                                     │
│     - Delete old temporary files (if any)                               │
│     - Trigger background optimizations (compaction, index updates, etc.)│
└─────────────────────────────────────────────────────────────────────────┘
```

**Complete Transaction Sequence Diagram**:

```
  User App          Dataset          FileWriter        ObjectStore       LockService
     │                │                  │                  │                  │
     │─append(data)──>│                  │                  │                  │
     │                │─get_manifest()──>│                  │                  │
     │                │<─────────────────│                  │                  │
     │                │                  │                  │                  │
     │                │─create_writer()─>│                  │                  │
     │                │                  │                  │                  │
     │                │                  │─encode_batch()   │                  │
     │                │                  │─write_pages()───>│ PUT data.lance.tmp
     │                │                  │                  │                  │
     │                │                  │<─────────────────│ OK               │
     │                │                  │                  │                  │
     │                │                  │─finish()         │                  │
     │                │                  │─write_footer()──>│ PUT (append)     │
     │                │                  │                  │                  │
     │                │                  │<─────────────────│ OK               │
     │                │                  │                  │                  │
     │                │─acquire_lock()────────────────────────────────────────>│
     │                │<───────────────────────────────────────────────────────│ OK
     │                │                  │                  │                  │
     │                │─update_manifest()>│                  │                  │
     │                │                  │─PUT _versions/N.manifest───────────>│
     │                │                  │                  │                  │
     │                │                  │<─────────────────│ OK               │
     │                │─release_lock()────────────────────────────────────────>│
     │                │<───────────────────────────────────────────────────────│ OK
     │                │                  │                  │                  │
     │<─Ok()──────────│                  │                  │                  │
     │                │                  │                  │                  │
```

### 3.4 Read Flow

```rust
// Table level: Scan data (Dataset::scan)
async fn scan(dataset: &Dataset, projection: &[&str]) -> Result<RecordBatchStream> {
    let manifest = dataset.current_manifest();
    
    // 1. Determine columns to read
    let column_indices = resolve_columns(&manifest.schema, projection)?;
    
    // 2. Iterate all DataFragments
    let mut streams = Vec::new();
    for fragment in &manifest.fragments {
        // 3. Open each .lance file (file format layer)
        for data_file in &fragment.files {
            let reader = FileReader::open(&data_file.path).await?;
            
            // 4. Read projected columns (handled by file format layer)
            let stream = reader.read_columns(&column_indices).await?;
            streams.push(stream);
        }
    }
    
    // 5. Merge streams from multiple files
    Ok(merge_streams(streams))
}
```

```
  ┌────────────┐
  │  .lance    │
  │   File     │
  └─────┬──────┘
        │
        ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  FileReader Open Phase (Metadata Reading)                           │
  ├─────────────────────────────────────────────────────────────────────┤
  │  1. Read Footer (40 bytes) ──► Get CMO/GBO positions, version,      │
  │                               column count                           │
  │  2. Read GBO ────────────────► Get Schema position                  │
  │  3. Read CMO ────────────────► Get column metadata positions        │
  │  4. Read ColumnMetadata ─────► Get page list, encoding info per     │
  │                               column                                 │
  └─────────────────────────────────────────────────────────────────────┘
        │
        ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  Random Access Read Phase (Data Reading)                            │
  ├─────────────────────────────────────────────────────────────────────┤
  │  5. Locate Page ─────────────► Find corresponding Page by row       │
  │                               number                                 │
  │  6. Calculate Byte Range ────► Use Repetition Index to calculate    │
  │                               data offset                            │
  │  7. I/O Scheduling ──────────► Merge ranges, priority sorting,      │
  │                               concurrent execution                   │
  │  8. Decode Data ─────────────► Full Zip/Mini-block decoding         │
  └─────────────────────────────────────────────────────────────────────┘
        │
        ▼
  ┌─────────────┐
  │ RecordBatch │
  │   (Arrow)   │
  └─────────────┘
```

```
  ┌─────────────────────────────────────────────────────────────────┐
  │                    Read Path                                    │
  ├─────────────────────────────────────────────────────────────────┤
  │                                                                 │
  │   User Request → Manifest Load → Fragment Select → File Read    │
  │                ↓              ↓           ↓                     │
  │           Schema Parse    Column     I/O Scheduling             │
  │                ↓          Projection      ↓                     │
  │           Statistics    Page Locator   Data Decode              │
  │                ↓              ↓           ↓                     │
  │           Version Mgmt  Row Filter    Arrow Conversion          │
  │                ↓              ↓           ↓                     │
  │           MVCC Support  System Col    Return Result             │
  │                         Calculation                             │
  │                                                                 │
  └─────────────────────────────────────────────────────────────────┘
```

**Step 1: Manifest Loading (Table Level)**

  User: "Read rows 50-100 of dataset v5"
      ↓
  ┌─────────────────────────────────────────┐
  │  1. Locate Manifest file                │
  │     _versions/5.manifest                │
  │     or _manifests/{u64::MAX-5}.manifest │
  └─────────────────────────────────────────┘
      ↓
  ┌─────────────────────────────────────────┐
  │  2. Read Optimization (Prefetch)        │
  │     - Read last 64KB of data            │
  │     - Extract offset from -16 to -8     │
  │       bytes                             │
  │     - Read complete manifest if needed  │
  └─────────────────────────────────────────┘
      ↓
  ┌─────────────────────────────────────────┐
  │  3. Parse Protobuf                      │
  │     - Schema                            │
  │     - Fragments list                    │
  │     - Index information                 │
  │     - Transaction metadata              │
  └─────────────────────────────────────────┘

**Step 2: Fragment Selection (Row Positioning)**

  Manifest { fragments: [F0, F1, F2, ...] }
      ↓
  ┌─────────────────────────────────────────┐
  │  Use fragment_offsets binary search     │
  │  - F0: rows 0-39                        │
  │  - F1: rows 40-80    ← need rows 50-80  │
  │  - F2: rows 80-120   ← need rows 80-100 │
  └─────────────────────────────────────────┘
      ↓
  Determine need to read: F1 (rows 10-40) and F2 (rows 0-20)

**Step 3: File Level Reading (Core)**

  3.1 Footer Read

  File: column_0.lance
      ↓
  Read last 40 bytes:
  ┌─────────────────────────────────────────────────────────┐
  │  Offset    │  Size │  Field                             │
  ├─────────────────────────────────────────────────────────┤
  │  -40..-33  │  8    │  Column Metadata 0 Position        │
  │  -32..-25  │  8    │  CMO Table Offset                  │
  │  -24..-17  │  8    │  GBO Table Offset                  │
  │  -16..-13  │  4    │  Global Buffer Count               │
  │  -12..-9   │  4    │  Column Count                      │
  │  -8..-7    │  2    │  Minor Version                     │
  │  -6..-5    │  2    │  Major Version                     │
  │  -4..-1    │  4    │  Magic "LANC"                      │
  └─────────────────────────────────────────────────────────┘

  3.2 CMO Table Read (Column Projection)

  Read CMO Table (16 × num_columns bytes):
  ┌─────────────────────────────────────────────────────────┐
  │  [Col 0 Position: u64] [Col 0 Size: u64]               │
  │  [Col 1 Position: u64] [Col 1 Size: u64]               │
  │  ...                                                    │
  │  [Col N Position: u64] [Col N Size: u64]               │
  └─────────────────────────────────────────────────────────┘
      ↓
  Select only required columns' metadata based on projection

  3.3 Column Metadata Read

  message ColumnMetadata {
    Encoding encoding = 1;              // Column-level encoding

    repeated Page pages = 2;            // All pages for this column
    message Page {
      repeated uint64 buffer_offsets = 1;  // Page data position in file
      repeated uint64 buffer_sizes = 2;    // Buffer sizes
      uint64 length = 3;                   // Number of rows in page
      Encoding encoding = 4;               // Page encoding method
      uint64 priority = 5;                 // Starting row number
    }

    repeated uint64 buffer_offsets = 3;   // Column-level buffers
    repeated uint64 buffer_sizes = 4;
  }

  3.4 Page Level Reading

  Determine required pages based on row range:
      Page 0: priority=0,   length=1024  (rows 0-1023)
      Page 1: priority=1024, length=1024  (rows 1024-2047)
      ↓
  Read corresponding buffers for the pages (parallel I/O)

**Step 4: I/O Scheduling**:

  ┌─────────────────────────────────────────────────────────┐
  │              lance-io Scheduler                         │
  ├─────────────────────────────────────────────────────────┤
  │                                                         │
  │  Three-level Concurrency Control:                       │
  │  1. Process-level: LANCE_PROCESS_IO_THREADS_LIMIT       │
  │     (default 128)                                       │
  │  2. Scheduler-level: Memory-based backpressure control  │
  │  3. Scan-level: Parallelism per operation               │
  │                                                         │
  │  Features:                                              │
  │  - Priority queue: Sorted by row number                 │
  │  - Request merging: Auto-merge adjacent reads           │
  │  - Backpressure warning: Issued after 5 seconds         │
  │                                                         │
  └─────────────────────────────────────────────────────────┘

**Step 5: Data Decoding (Encoding Stack)**:

  Two-layer encoding system:

                      Compressed data (bytes in file)
                           ↓
      ┌─────────────────────────────────────────────────┐
      │  Layer 1: Structural Encoding                   │
      │  - Determines how to organize data for I/O      │
      └─────────────────────────────────────────────────┘
                           ↓
      ┌──────────┬──────────┬──────────┬──────────┐
      │          │          │          │          │
      ▼          ▼          ▼          ▼          ▼
  MiniBlock  FullZip    Constant    Blob       ...
  Layout     Layout     Layout      Layout
  (Small)    (Large)   (Constant)  (Large Obj)
      │          │          │          │
      └──────────┼──────────┼──────────┘
                 │          │
                 ▼          ▼
      ┌─────────────────────────────────────────────────┐
      │  Layer 2: Compressive Encoding                  │
      │  - Determines how to compress data              │
      └─────────────────────────────────────────────────┘
                 ↓
      ┌─────┬──────┬─────┬─────┬─────┬─────┬─────┐
      │     │      │     │     │     │     │     │
      ▼     ▼      ▼     ▼     ▼     ▼     ▼     ▼
     Flat Variable Dict Bit  FSST  RLE   BSS   General
                                │                  │
                                └──────────────────┘
                                           ↓
                                Optional: Zstd/Lz4
                                           ↓
                                     Arrow Array

  Structural Encoding Details:

   Encoding    Use Case              Characteristics
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MiniBlock   Small data (<128B/val) 8KB chunks, opaque compression
   FullZip     Large data (≥128B/val) Row-major transpose, transparent
                                     compression, random access
   Constant    All values identical   Inline storage, zero decode overhead
   Blob        Very large objects     Descriptor index, lazy loading

  Compressive Encoding Details:

   Encoding         Purpose      Example Effect
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Bitpacking       Small ints   u32 storing 5000 needs only 13 bits
   Dictionary       High repeat  [a,a,b,a] → indices[0,0,1,0]
   RLE              Many runs    [5,5,5,7,7] → values[5,7], runs[3,2]
   FSST             Strings      Fast Symbol Table 30-50% compression
   ByteStreamSplit  Floats       Separate by byte position, better ratio
   General          General      Final Zstd/Lz4 compression

**Step 6: System Column Calculation**:

  Data columns decoded to Arrow Array
      ↓
  ┌─────────────────────────────────────────┐
  │  Calculate system columns (virtual      │
  │  columns, not stored in file)           │
  ├─────────────────────────────────────────┤
  │  _rowaddr = (fragment_id << 32) | offset│
  │  _rowid   = lookup in RowIdSequence     │
  │  _row_created_at_version                │
  │  _row_last_updated_at_version           │
  └─────────────────────────────────────────┘
      ↓
  Assemble complete RecordBatch

**Caching Mechanism**:

  ┌─────────────────────────────────────────────────────────┐
  │                    Multi-level Caching                  │
  ├─────────────────────────────────────────────────────────┤
  │                                                         │
  │  1. LanceCache (File-level)                             │
  │     - CachedFileMetadata                                │
  │     - Schema, column metadata, page info                │
  │     - Repetition index cache (MiniBlock rep-index)      │
  │                                                         │
  │  2. Repetition Index                                    │
  │     - O(1) random access                                │
  │     - MiniBlock rep-index usually small, cached in RAM  │
  │     - FullZip has no rep-index, saves memory            │
  │                                                         │
  │  3. Decode Cache                                        │
  │     - Shared dictionary (in GBO)                        │
  │     - Page-level statistics                             │
  │                                                         │
  └─────────────────────────────────────────────────────────┘

### 3.5 Why This Layering?

**File Format Layer Focuses On**:
- ✅ Efficient columnar encoding/decoding
- ✅ Page management and I/O optimization
- ✅ Random access within single file

**Table Format Layer Handles**:
- ✅ Multi-file organization (DataFragment)
- ✅ Version management (Manifest)
- ✅ Schema evolution (add/remove columns)
- ✅ Transaction isolation (MVCC)
- ✅ Index lifecycle management

**Benefits**:
1. **Separation of Concerns**: File format layer can evolve independently
2. **Flexibility**: Different table format implementations (e.g., Lance v1 vs v2) can reuse the same file format
3. **Testability**: File format layer can be tested standalone without full table infrastructure

### 3.6 File Format vs Table Format Comparison

| Feature | File Format Layer (lance-file) | Table Format Layer (lance-table) |
|---------|-------------------------------|----------------------------------|
| **Focus** | Data organization within single file | Multi-file coordination |
| **Persistence Unit** | `.lance` file | Manifest + data file collection |
| **Version Management** | Version numbers only (v2.0, v2.1) | MVCC + Manifest history chain |
| **Schema Evolution** | Stores current Schema | Supports Schema change history |
| **Transactions** | None (relies on external atomic writes) | ACID transaction guarantees |
| **Indexes** | None (encoding metadata only) | Vector indexes, scalar index management |
| **Concurrency Control** | None (single-file writes) | Optimistic locking, conflict detection |
| **Typical Operations** | `read_columns`, `random_access` | `append`, `delete`, `update`, `merge` |
| **Cache Granularity** | Page cache | Fragment cache, index cache |
| **Use Cases** | Underlying storage engine | Upper-layer database interface |

**Layer Correspondence**:

```
┌──────────────────────────────────────────────────────────────┐
│  User Interface Layer (Python/Rust SDK)                      │
│  - Dataset::append()                                         │
│  - Dataset::scan()                                           │
│  - Dataset::create_index()                                   │
└───────────────────────┬──────────────────────────────────────┘
                        │ Calls
┌───────────────────────▼──────────────────────────────────────┐
│  Table Format Layer (lance-table)                            │
│  - Manifest management                                       │
│  - Transaction coordination                                  │
│  - Index lifecycle                                           │
└───────────────────────┬──────────────────────────────────────┘
                        │ Manages multiple
┌───────────────────────▼──────────────────────────────────────┐
│  File Format Layer (lance-file)                              │
│  - Read/write individual .lance files                        │
│  - Page management, encoding/decoding                        │
└──────────────────────────────────────────────────────────────┘
```


---

## Chapter 4: File Physical Layout

### 4.1 Overall Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                         Lance File                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Data Section                                           │    │
│  │  - Column data buffers (Column Pages)                   │    │
│  │  - Global Buffers actual data (indexed via GBO)        │    │
│  │    * Global Buffer #0: FileDescriptor (Protobuf)       │    │
│  │    * Global Buffer #1+: Dictionary pages, Custom meta  │    │
│  │  - 64-byte alignment                                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Column Metadata Section                                │   │
│  │  - One Protobuf ColumnMetadata message per column       │   │
│  │  - Contains page descriptions and encoding info         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Column Metadata Offset Table (CMO)                     │   │
│  │  - Position and size of each column's metadata          │   │
│  │  - Fixed format: (u64 position, u64 size) array        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Global Buffer Offset Table (GBO)                       │   │
│  │  - File offset and size of each global buffer           │   │
│  │  - Points to Global Buffers data in Data Section       │   │
│  │  - Fixed format: (u64 position, u64 size) array        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Footer (40 bytes, including Magic)                     │   │
│  │  - column_meta_start: u64 (8 bytes)                     │   │
│  │  - column_meta_offsets_start: u64 (8 bytes)             │   │
│  │  - global_buff_offsets_start: u64 (8 bytes)             │   │
│  │  - num_global_buffers: u32 (4 bytes)                    │   │
│  │  - num_columns: u32 (4 bytes)                           │   │
│  │  - major_version: u16 (2 bytes)                         │   │
│  │  - minor_version: u16 (2 bytes)                         │   │
│  │  - Magic: "LANC" (4 bytes)                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**DataSection Part**

```
DataSection Internal Layout:
  ┌─────────────────────────────────────────────────────────────────┐
  │  Column 0, Page 0                                               │
  │  ├─ Buffer 0: Repetition Levels (optional)                      │
  │  ├─ Buffer 1: Definition Levels (optional)                      │
  │  ├─ Buffer 2: Actual data (compressed)                          │
  │  └─ Padding: Pad to 64-byte alignment                           │
  ├─────────────────────────────────────────────────────────────────┤
  │  Column 0, Page 1                                               │
  │  ├─ Buffer 0: ...                                               │
  │  └─ ...                                                         │
  ├─────────────────────────────────────────────────────────────────┤
  │  Column 1, Page 0                                               │
  │  ├─ Buffer 0: ...                                               │
  │  └─ ...                                                         │
  ├─────────────────────────────────────────────────────────────────┤
  │  ... (more columns and pages)                                   │
  ├─────────────────────────────────────────────────────────────────┤
  │  Global Buffer #0: FileDescriptor (Protobuf)                    │
  ├─────────────────────────────────────────────────────────────────┤
  │  Global Buffer #1: Dictionary (optional)                        │
  ├─────────────────────────────────────────────────────────────────┤
  │  Global Buffer #2: Custom Metadata (optional)                   │
  └─────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────-────────────────────┐
│                            LANCE v2.X File Structure                         │
├─────────────────────────────────────────────────────────────-────────────────┤
│ Data Section                                                                 │
│   ├─ Data Buffer 0* (64-byte aligned)                                        │
│   ├─ Data Buffer 1*                                                          │
│   └─ ...                                                                     │
├───────────────────────────────────────────────────────────────-──────────────┤
│ Column Metadata Section                                                      │
│   ├─ Column 0 Metadata (Protobuf)                                            │
│   ├─ Column 1 Metadata                                                       │
│   └─ ...                                                                     │
├─────────────────────────────────────────────────────────────────-────────────┤
│ CMO Table (Column Metadata Offset)                                           │
│   ├─ [position: u64, size: u64] × N columns                                  │
├────────────────────────────────────────────────────────────────-─────────────┤
│ GBO Table (Global Buffer Offset)                                             │
│   ├─ [position: u64, size: u64] × M buffers                                  │
├───────────────────────────────────────────────────────────────-──────────────┤
│ Footer (40 bytes)                                                            │
│   ├─ offset to Column Metadata 0: u64                                        │
│   ├─ offset to CMO table: u64                                                │
│   ├─ offset to GBO table: u64                                                │
│   ├─ num_global_buffers: u32                                                 │
│   ├─ num_columns: u32                                                        │
│   ├─ major_version: u16                                                      │
│   ├─ minor_version: u16                                                      │
│   └─ magic: "LANC" (4 bytes)                                                 │
└───────────────────────────────────────────────────────────────-──────────────┘
```

The main body consists of data Pages for each column, where each Page is an encoded data block.
- A .lance file contains multiple Pages;
- Each Page contains multiple 64-byte aligned buffers internally.

**DataSection Read/Write Flow**

  Write Flow

  1. Encoding Phase
     RecordBatch → FieldEncoder → EncodedPage { buffers, encoding }
                          ↓
  2. Allocate Offsets
     Allocate positions within DataSection for each buffer (64-byte aligned)
                          ↓
  3. Write Data
     Write buffers to DataSection in order
                          ↓
  4. Record Metadata
     Page { buffer_offsets, buffer_sizes, encoding }


  Read Flow

  1. Read Footer → Get CMO/GBO positions
                          ↓
  2. Read CMO Table → Get column metadata positions
                          ↓
  3. Read ColumnMetadata → Get Page list
                          ↓
  4. Locate Page based on row number
     priority + length determines which page contains the target row
                          ↓
  5. Read buffers from DataSection
     Direct positioning using Page.buffer_offsets
                          ↓
  6. Decode data
     Apply decoding process described by encoding


Relationship Between DataSection and Other Components

```
   Component            Relationship with DataSection
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Column Metadata      Describes position and encoding of pages in DataSection
   CMO Table            Points to position of Column Metadata
   GBO Table            Points to position of Global Buffers in DataSection
   Footer               Points to position of CMO/GBO
```

Metadata is scattered and loaded on demand.

> **⚠️ Note: Storage Location of Global Buffers**
> 
> The **actual data** of Global Buffers is stored in the **Data Section**, mixed with other column data buffers.
> 
> - **GBO (Global Buffer Offset Table)** is just an index table, recording the **file offset and size** of each Global Buffer in the Data Section
> - **Global Buffer #0** stores FileDescriptor (Protobuf serialized), which contains the Arrow Schema
> - **Global Buffer #1+** can store dictionary pages, user-defined metadata, etc.
> 
> Advantages of this design:
> - All data is uniformly managed with 64-byte alignment
> - Global buffers can be prefetched together with column data
> - Prevents the file tail metadata area from becoming too large

### 4.2 Footer Detailed Structure

**Footer is fixed at 40 bytes** (`FOOTER_LEN: usize = 40`, **including Magic Number**), using little-endian byte order:

```rust
// rust/lance-file/src/reader.rs:373
pub(crate) const FOOTER_LEN: usize = 40;  // Includes Magic (36 bytes fields + 4 bytes Magic)
pub const MAGIC: &[u8; 4] = b"LANC";      // 0x4C 0x41 0x4E 0x43
```

**Footer Structure = 36 bytes (field data) + 4 bytes (Magic) = 40 bytes**

**Footer Layout**:

> Note: Footer is stored in the file in **read order** (from low address to high address), which is the order the `Cursor` reads in the code.

```
File tail layout (looking from end of file):

Offset from End  │  Size    │  Field                           │ Description
─────────────────┼──────────┼──────────────────────────────────┼─────────────────
0                │ 40 bytes │ Footer (includes Magic "LANC")   │ ← FOOTER_LEN
40               │          │                                  │ End of file

Footer main internal layout (in read order, from low address to high address):

Read Order │ Offset in Footer │  Size   │  Field
───────────┼──────────────────┼─────────┼────────────────────────
    1      │ 0                │ 8 bytes │ Column Metadata 0 Position
    2      │ 8                │ 8 bytes │ CMO Table Position
    3      │ 16               │ 8 bytes │ GBO Table Position
    4      │ 24               │ 4 bytes │ Number of Global Buffers
    5      │ 28               │ 4 bytes │ Number of Columns
    6      │ 32               │ 2 bytes │ Major Version
    7      │ 34               │ 2 bytes │ Minor Version
───────────┼──────────────────┼─────────┼────────────────────────
           │ Total Fields     │ 36 bytes│
           │ + Magic          │ 4 bytes │
           │ = FOOTER_LEN     │ 40 bytes│
```

**Code for Reading Footer** (`reader.rs`):

```rust
pub async fn read_footer(reader: &dyn Reader) -> Result<FileMetadata> {
    let file_size = reader.size().await?;
    
    // 1. Read Footer (last 40 bytes of file, including Magic)
    // File position: [file_size-40 .. file_size)
    let footer_bytes = reader.get_range((file_size - 40)..file_size).await?;
    
    // 2. Validate Magic (last 4 bytes)
    let magic = &footer_bytes[36..40];
    if magic != MAGIC { return Err(Error::InvalidMagic); }
    
    // 3. Parse fields (first 36 bytes)
    let mut cursor = Cursor::new(&footer_bytes[0..36]);
    let column_meta_start = cursor.read_u64::<LittleEndian>()?;      // 8 bytes
    let cmo_table_pos = cursor.read_u64::<LittleEndian>()?;          // 8 bytes
    let gbo_table_pos = cursor.read_u64::<LittleEndian>()?;          // 8 bytes
    let num_global_buffers = cursor.read_u32::<LittleEndian>()?;     // 4 bytes
    let num_columns = cursor.read_u32::<LittleEndian>()?;            // 4 bytes
    let major_version = cursor.read_u16::<LittleEndian>()?;          // 2 bytes
    let minor_version = cursor.read_u16::<LittleEndian>()?;          // 2 bytes
    // Total fields: 8+8+8+4+4+2+2 = 36 bytes ✓
    
    Ok(FileMetadata { ... })
}
```

### 4.3 Data Area Organization

**Buffer Concept**:

```rust
// Characteristics of each buffer
struct DataBuffer {
    offset: u64,      // File offset (64-byte aligned)
    size: u64,        // Buffer size (bytes)
}
```

**Alignment Requirements**:
- **64-byte alignment**: All buffer starting positions must be 64-byte aligned (SIMD optimization, matching CPU cache line)
- **Optional sector alignment**: For Direct I/O, 4096-byte alignment is required
- **Padding insertion**: Writer inserts padding between buffers to satisfy alignment

#### 4.3.1 GBO Table Structure Details

GBO (Global Buffer Offset Table) is a fixed-format array before the Footer, recording the position of each global buffer:

```
GBO Table Memory Layout (16 bytes per entry):
┌─────────────────────────────────────────────────────────┐
│  Entry 0 (Global Buffer #0)                             │
│  ├─ offset: u64 (8 bytes)  → Absolute offset of Schema │
│  └─ size:   u64 (8 bytes)  → Schema size (bytes)       │
├─────────────────────────────────────────────────────────┤
│  Entry 1 (Global Buffer #1)                             │
│  ├─ offset: u64 (8 bytes)  → Dictionary offset (if any)│
│  └─ size:   u64 (8 bytes)  → Dictionary size           │
├─────────────────────────────────────────────────────────┤
│  Entry 2 (Global Buffer #2)                             │
│  ├─ offset: u64 (8 bytes)  → Custom Metadata offset    │
│  └─ size:   u64 (8 bytes)  → Custom Metadata size      │
├─────────────────────────────────────────────────────────┤
│  ...                                                    │
└─────────────────────────────────────────────────────────┘

Total size = num_global_buffers × 16 bytes
```

**Typical Global Buffer Contents**:

| Index | Content | Format | Description |
|-------|---------|--------|-------------|
| #0 | **FileDescriptor** | Protobuf | Must exist, contains Arrow Schema and row count metadata |
| #1 | Dictionary (optional) | Arrow IPC | Shared dictionary for dictionary-encoded columns |
| #2 | Custom Metadata (optional) | JSON / Protobuf | User-defined key-value pairs |
| #3+ | Extended use | - | Reserved for future extensions |

#### 4.3.2 GBO Table Memory Layout Example

Assuming a file contains Schema + Dictionary + Custom Metadata (3 global buffers in total):

```
GBO Table (assuming starts at file offset 0x5000):
┌─────────────────────────────────────────────────────────────────┐
│ Entry 0: FileDescriptor (Schema)                                │
│ ├─ offset: 0x0000000000001000  (4096)   → Data at 4096 bytes   │
│ └─ size:   0x0000000000000800  (2048)   → Length 2048 bytes    │
├─────────────────────────────────────────────────────────────────┤
│ Entry 1: Dictionary                                             │
│ ├─ offset: 0x0000000000001800  (6144)   → Data at 6144 bytes   │
│ └─ size:   0x0000000000000400  (1024)   → Length 1024 bytes    │
├─────────────────────────────────────────────────────────────────┤
│ Entry 2: Custom Metadata                                        │
│ ├─ offset: 0x0000000000001C00  (7168)   → Data at 7168 bytes   │
│ └─ size:   0x0000000000000200  (512)    → Length 512 bytes     │
└─────────────────────────────────────────────────────────────────┘

Memory Layout (little-endian, hexadecimal representation):
Offset    0  1  2  3  4  5  6  7  8  9  A  B  C  D  E  F
0x5000   00 10 00 00 00 00 00 00  00 08 00 00 00 00 00 00  │ Entry 0 │
0x5010   00 18 00 00 00 00 00 00  00 04 00 00 00 00 00 00  │ Entry 1 │
0x5020   00 1C 00 00 00 00 00 00  00 02 00 00 00 00 00 00  │ Entry 2 │
         └──────────┬──────────┘  └──────────┬──────────┘
                   offset (8 bytes)          size (8 bytes)

Total size = 3 × 16 bytes = 48 bytes

Corresponding Rust structure:
[
    BufferDescriptor { offset: 4096,  size: 2048 },   // Schema
    BufferDescriptor { offset: 6144,  size: 1024 },   // Dictionary
    BufferDescriptor { offset: 7168,  size: 512 },    // Custom Metadata
]
```

**Verify Read Process**:
```rust
// Read Schema (Global Buffer #0)
let schema_offset = buffers[0].offset;  // 4096
let schema_size = buffers[0].size;      // 2048
let schema_bytes = reader.get_range(schema_offset..schema_offset + schema_size).await?;
let schema = deserialize_arrow_schema(&schema_bytes)?;
```

**Code Logic for Reading GBO**:

```rust
async fn read_gbo_table(
    reader: &dyn Reader,
    gbo_position: u64,
    num_global_buffers: u32,
) -> Result<Vec<BufferDescriptor>> {
    let gbo_size = num_global_buffers as u64 * 16;  // 16 bytes per entry
    let gbo_bytes = reader.get_range(gbo_position..gbo_position + gbo_size).await?;
    
    let mut buffers = Vec::with_capacity(num_global_buffers as usize);
    let mut cursor = Cursor::new(gbo_bytes);
    
    for _ in 0..num_global_buffers {
        let offset = cursor.read_u64::<LittleEndian>()?;
        let size = cursor.read_u64::<LittleEndian>()?;
        buffers.push(BufferDescriptor { offset, size });
    }
    
    Ok(buffers)
}
```

### 4.4 Concept of Page

Page is the **basic unit for data organization and I/O scheduling** in Lance files:

```protobuf
// file2.proto:167-188
message ColumnMetadata {
  message Page {
    repeated uint64 buffer_offsets = 1;  // Absolute byte offset of buffer in file
    repeated uint64 buffer_sizes = 2;    // Buffer size (bytes)
    uint64 length = 3;                   // Logical row count
    Encoding encoding = 4;               // Page encoding description
    uint64 priority = 5;                 // Priority = starting row number
  }
  
  repeated Page pages = 2;  // All pages for this column
}
```

> **Note**: `buffer_offsets` are **absolute byte offsets in the file** (starting from 0 at file beginning), which can be used directly for I/O requests without additional calculation.

**Page Design Principles** (`file2.proto:103-107`):

> "Data pages should be large. The only time a page should be written to disk is when the writer needs to flush the page to disk because it has accumulated too much data. Pages are not read in sequential order and if pages are too small then the seek overhead (or request overhead) will be problematic. We generally advise that pages be at least 8MB or larger."

**Page Size Strategy**:
- **Recommended size**: ≥ 8MB (reduces seek overhead)
- **Maximum limit**: Default 32MB (configurable)
- **V2.1+ improvement**: Allow large pages when writing, split into 8MB chunks on demand when reading

### 4.5 Column Metadata Structure

```protobuf
// file2.proto:164-204
message ColumnMetadata {
  // 1. Column-level encoding (describes how to interpret metadata buffers)
  Encoding encoding = 1;
  
  // 2. Page array (sorted by row number)
  repeated Page pages = 2;
  
  // 3. Column metadata buffers (statistics, dictionaries, etc.)
  repeated uint64 buffer_offsets = 3;  // Absolute byte offset in file
  repeated uint64 buffer_sizes = 4;    // Buffer size (bytes)
}
```

---



---

## Chapter 5: Encoding System Architecture

### 5.1 Layered Encoding Design

Lance v2.1+ divides encoding into two layers:

```
Structural Encoding
    ↓
    ├─ MiniBlockLayout (small data types: scalars, short strings)
    ├─ FullZipLayout (large data types: vectors, long text, nested structures)
    ├─ ConstantLayout (constant values)
    └─ BlobLayout (large objects)
        ↓
Compressive Encoding
    ↓
    ├─ BitPacking (bit packing)
    ├─ RLE (run-length encoding)
    ├─ FSST (string compression)
    ├─ Zstd/Lz4 (general compression)
    └─ Dictionary (dictionary encoding)
```

#### 5.1.1 Compressive Encoding Details

##### BitPacking Bit Width Selection Strategy

BitPacking packs multiple integers into smaller bit widths to reduce storage space.

**Bit Width Calculation** (based on actual data range):

```rust
// lance-encoding/src/statistics.rs
fn calculate_max_bit_width<T: PrimInt>(slice: &[T], bits_per_value: u64) -> Vec<u64> {
    slice
        .chunks(CHUNK_SIZE)  // One chunk per 1024 values
        .map(|chunk| {
            // Calculate bitwise OR of all values in chunk (gets max significant bit)
            let max_value = chunk.iter().fold(T::zero(), |acc, &x| acc | x);
            // Actual required bit width = total bits - leading zeros count
            bits_per_value - max_value.leading_zeros() as u64
        })
        .collect()
}
```

**Key Characteristics**:
- Uses **minimum necessary bit width**, no alignment
- One chunk per 1024 values, each chunk calculates bit width independently
- Bit width stored inline in chunk header (1 byte)

**Actual Bit Width Examples** (from Lance test cases):

| Data | Calculated Bit Width | Description |
|------|---------------------|-------------|
| `[1, 2, 3]` | **2 bits** | Max value is 3 (0b11) |
| `[1, 2, 3, 0x1F]` | **5 bits** | Max value is 31 (0b11111) |
| `[1, 2, 3, 0x7F]` | **7 bits** | Max value is 127 |
| `[1, 2, 3, 0x1FF]` | **9 bits** | Max value is 511 |
| `[1, 2, 3, 0xFF]` | **8 bits** | Max value is 255 |

> **Note**: Lance uses actual bit widths (e.g., 5-bit, 9-bit, 13-bit), **without 8/16/32/64 alignment**. This is different from some other bit-packing implementations.

**Applicable Scenarios**:
- Integer columns (especially IDs, counters, and other small-range values)
- Compression ratio can typically reach **2-8x**
- Extremely fast decompression speed (SIMD optimized, ~10GB/s)

##### FSST String Compression

FSST (Fast Static Symbol Table) is a fast compression algorithm for strings.

**Working Principle**:
1. **Build Symbol Table**: Scan strings to find high-frequency substrings (2-8 bytes)
2. **Static Replacement**: Replace high-frequency substrings with 1-byte codes
3. **Reserved Code Points**: Among 256 code points, 1 represents "literal", the remaining 255 represent symbols

```
Original string: "https://example.com/api/v1/users"
Symbol table: {
    0x01 -> "https://",
    0x02 -> "example.com",
    0x03 -> "/api/v1/"
}
Compressed: [0x01, 0x02, 0x03, "users"]  (only 1+1+1+5=8 bytes vs original 32 bytes)
```

**Applicable Scenarios**:
- URLs, JSON strings, log messages, and other text with **many repetitive patterns**
- Short strings (<100 bytes) work best
- Compression ratio: **2-5x**
- Decompression speed: **~1GB/s** (10x faster than Zstd)

**Not Applicable Scenarios**:
- Completely random strings (UUIDs, hash values)
- Columns where each value is unique (e.g., primary keys)

#### 5.1.2 Adaptive Encoding Selection Strategy

The Lance encoder automatically selects the optimal encoding combination based on data characteristics.

**Decision Flow**:

```rust
// Actual encoding selection logic in Lance source (primitive.rs)

const MINIBLOCK_MAX_BYTE_LENGTH_PER_VALUE: u64 = 256;

fn is_narrow(data_block: &DataBlock) -> bool {
    // Check max length stat (not avg length)
    if let Some(max_len) = data_block.get_stat(Stat::MaxLength) {
        return max_len < MINIBLOCK_MAX_BYTE_LENGTH_PER_VALUE;  // < 256 bytes
    }
    false
}

fn prefers_miniblock(
    data_block: &DataBlock,
    encoding_metadata: &HashMap<String, String>,
) -> bool {
    // User override via STRUCTURAL_ENCODING_META_KEY
    if let Some(user) = encoding_metadata.get(STRUCTURAL_ENCODING_META_KEY) {
        return user == STRUCTURAL_ENCODING_MINIBLOCK;
    }
    // Otherwise: use miniblock if narrow (max_len < 256 bytes)
    Self::is_narrow(data_block)
}

fn choose_encoding(data: &DataBlock, data_type: &DataType) -> EncodingStrategy {
    // 1. Structural encoding selection
    let structural = match data_type {
        // Small data types (scalars) → Mini-block
        DataType::Int8|Int16|Int32|Int64|Float32|Float64|Boolean => {
            StructuralEncoding::MiniBlock
        }
        // Strings/binary: based on max_len judgment
        DataType::Utf8|LargeUtf8|Binary|LargeBinary => {
            if is_narrow(data) {  // max_len < 256
                StructuralEncoding::MiniBlock
            } else {
                StructuralEncoding::FullZip  // Large data uses Full Zip
            }
        }
        // Constant values → Constant
        DataType::FixedSizeBinary(_) if is_constant(data) => {
            StructuralEncoding::Constant
        }
        // Nested types → Full Zip (handles Rep-Def)
        DataType::List(_) | DataType::Struct(_) => {
            StructuralEncoding::FullZip
        }
        _ => StructuralEncoding::FullZip,
    };
    
    // 2. Compressive encoding selection (based on data characteristics)
    let compressive = match data_type {
        DataType::Int8|Int16|Int32|Int64 => {
            // BitPacking always available, each chunk selects bit width independently
            // Actual implementation: decide whether to use BitPacking based on statistics
            if should_use_bitpacking(&data.stats()) {
                // bit_width determined by each chunk's data range
                CompressiveEncoding::BitPacking
            } else if has_run_length_pattern(data) {
                CompressiveEncoding::RLE
            } else {
                CompressiveEncoding::None
            }
        }
        DataType::Utf8 | DataType::LargeUtf8 => {
            // FSST selection based on string patterns and cardinality
            if should_use_fsst(data) {
                CompressiveEncoding::FSST
            } else if has_low_cardinality(data) {
                CompressiveEncoding::Dictionary
            } else {
                CompressiveEncoding::Zstd
            }
        }
        _ => CompressiveEncoding::None,
    };
    
    EncodingStrategy { structural, compressive }
}
```

**Data Feature Detection** (actual Lance heuristics):

| Feature | Detection Method | Threshold/Condition | Selection Strategy |
|---------|-----------------|---------------------|-------------------|
| **Narrow data** | `max_len < 256` | < 256 bytes | MiniBlockLayout |
| **Wide data** | `max_len >= 256` | ≥ 256 bytes | FullZipLayout |
| **Constant** | All values equal | 100% | ConstantLayout |
| **Low cardinality** | Unique values / Total < 10% | < 10% | Dictionary |
| **Runs** | Consecutive duplicate value ratio | > 50% | RLE |
| **Small range integers** | `max_bit_width < original bit width` | Space savings possible | BitPacking |
| **String patterns** | High-frequency substrings (FSST stats) | Heuristic | FSST |
| **High nesting depth** | Average depth > 3 | > 3 | FullZip |

> **Key Difference**: The MiniBlock vs FullZip decision is based on **max_len** (maximum length), not avg_len (average length). The threshold is **256 bytes** (`MINIBLOCK_MAX_BYTE_LENGTH_PER_VALUE`), not 100 bytes.

**Sampling Strategy** (to avoid full analysis):

```rust
fn sample_for_analysis(data: &DataBlock) -> DataBlock {
    const SAMPLE_SIZE: usize = 10000;
    
    if data.len() <= SAMPLE_SIZE {
        data.clone()
    } else {
        // Stratified sampling: take portions from beginning, middle, and end
        let step = data.len() / SAMPLE_SIZE;
        data.iter()
            .step_by(step)
            .take(SAMPLE_SIZE)
            .collect()
    }
}
```

### 5.2 Mini-block Encoding

**Applicable Scenarios**: Small data types (scalars, short strings)

```protobuf
// encodings_v2_1.proto:77-118
message MiniBlockLayout {
  CompressiveEncoding rep_compression = 1;      // Repetition level compression
  CompressiveEncoding def_compression = 2;      // Definition level compression
  CompressiveEncoding value_compression = 3;    // Value compression
  CompressiveEncoding dictionary = 4;           // Dictionary compression (optional)
  uint64 num_dictionary_items = 5;              // Number of dictionary items
  
  repeated RepDefLayer layers = 6;              // Rep-Def layer semantics
  uint64 num_buffers = 7;                       // Buffers per block
  uint32 repetition_index_depth = 8;            // Repetition index depth
  uint64 num_items = 9;                         // Total item count
  
  bool has_large_chunk = 10;                    // v2.2+: Large chunk flag
}
```

**Core Characteristics**:
1. **Chunked Compression**: Data is split into 4-8KB small chunks (miniblocks)
2. **Rep-Def Integration**: Uses repetition/definition levels to handle nesting
3. **Read Amplification**: Must read entire block to access a single value
4. **Vectorization**: Encoding/decoding process can be highly vectorized

**Source Implementation** (`lance-encoding/src/encodings/logical/primitive/miniblock.rs`):

```rust
pub struct MiniBlockCompressor {
    strategy: DefaultCompressionStrategy,
    target_block_size: usize,  // Usually 4096 or 8192
}

impl MiniBlockCompressor for ValueEncoder {
    fn compress(&self, data: DataBlock) -> Result<(MiniBlockCompressed, CompressiveEncoding)> {
        // 1. Split data into chunks
        let chunks = data.split_into_chunks(self.target_block_size);
        
        // 2. Apply compression to each chunk
        let compressed_chunks = chunks.iter()
            .map(|chunk| self.compress_chunk(chunk))
            .collect::<Result<Vec<_>>>()?;
        
        // 3. Generate metadata (row count and offset per chunk)
        let chunk_metadata = compressed_chunks.iter()
            .map(|c| ChunkMeta {
                num_rows: c.num_rows,
                compressed_size: c.size,
            })
            .collect();
        
        Ok((MiniBlockCompressed {
            data: compressed_chunks,
            metadata: chunk_metadata,
        }, encoding_description))
    }
}
```

### 5.3 Full Zip Encoding

**Applicable Scenarios**: Large data types (vectors, long text, nested structures)

```protobuf
// encodings_v2_1.proto:124-148
message FullZipLayout {
  uint32 bits_rep = 1;              // Repetition level bit count
  uint32 bits_def = 2;              // Definition level bit count
  
  oneof details {
    uint32 bits_per_value = 3;      // Fixed width: bits per value
    uint32 bits_per_offset = 4;     // Variable width: bits per offset
  }
  
  uint32 num_items = 5;             // Total item count
  uint32 num_visible_items = 6;     // Visible item count (excluding nulls)
  CompressiveEncoding value_compression = 7;  // Value compression
  repeated RepDefLayer layers = 8;  // Rep-Def layer semantics
}
```

**Encoding Layout** (row-major order):

```
For each value (row):
┌──────────────┬──────────────┬──────────────┐
│ Control Word │ Length (opt) │ Value Data   │
│ (rep+def)    │ (var-width)  │ (compressed) │
└──────────────┴──────────────┴──────────────┘
```

**Control Word Structure**:

```
┌────────────────────────────────────┐
│  LSB                          MSB  │
│  [Def Levels][Rep Level][Padding] │
│  ↑          ↑                     │
│  Low bits   High bits             │
└────────────────────────────────────┘

For example Struct<List<String>>:
- Def Levels: 3 bits (000=valid, 001=null, 010=empty list, ...)
- Rep Level:  1 bit (0=continue list, 1=new list)
- Total: 4 bits → rounded up to 1 byte
```

**Source Implementation** (`lance-encoding/src/encodings/logical/primitive.rs`):

```rust
struct FullZipEncoder;

impl PerValueCompressor for FullZipEncoder {
    fn compress(&self, data: DataBlock) -> Result<(PerValueDataBlock, CompressiveEncoding)> {
        // 1. Build Rep-Def levels
        let (rep_levels, def_levels) = build_rep_def_levels(&data);
        
        // 2. Pack into control words (byte-aligned)
        let control_words = pack_control_words(rep_levels, def_levels);
        
        // 3. Transpose data to row-major
        let zipped_data = transpose_to_row_major(&data);
        
        // 4. Per-value compression (transparent compression)
        let compressed_values = per_value_compress(&zipped_data);
        
        // 5. Build repetition index
        let rep_index = build_repetition_index(&control_words);
        
        Ok(PerValueDataBlock {
            control_words,
            lengths: extract_lengths(&data),
            values: compressed_values,
            rep_index,
        }, encoding_description)
    }
}
```

### 5.4 Repetition Index

**Core Innovation**: The key to Full Zip encoding's random access capability

#### MiniBlock's Repetition Index

MiniBlock uses **per-chunk compact metadata**, not an independent offset array:

```rust
// MiniBlock metadata (2 bytes per chunk)
struct MiniBlockChunkMeta {
    // 12 bits: chunk byte count (in 8-byte units)
    // 4 bits: log2(value count in chunk), 0 for last chunk
}

// Repetition index is implicitly built through chunk metadata
// - Know each chunk's starting position and row count
// - Can calculate which chunk contains any row
```

**Characteristics**:
- Only 2 bytes metadata per chunk
- Embedded in Page's miniblock metadata
- No additional storage space needed

#### FullZip's Repetition Index

FullZip uses **explicit offset array**:

```rust
// lance-encoding/src/encodings/logical/primitive.rs
struct FullZipRepIndex {
    // Byte offset of each visible value in the data stream
    offsets: Vec<u64>,  // Stored as independent data buffer
}
```

**Working Principle**:

```
Assuming Full Zip encoded data (one value per row):
[Ctrl][Len][Data] [Ctrl][Len][Data] [Ctrl][Len][Data] ...
 Row 0             Row 1             Row 2
 ↑                 ↑                 ↑
 0x1000            0x1015            0x1030
(Byte offset per row)

The repetition index stores the byte offset of each visible value in the data stream:
rep_index = [0x1000, 0x1015, 0x1030, ...]
              ↑       ↑       ↑
           Row 0   Row 1   Row 2 starting offset

Random access process for Row N:
┌─────────────────────────────────────────────────────────┐
│ 1. Read rep_index[N]   → Get starting byte offset X      │
│    Read rep_index[N+1] → Get ending byte offset Y        │
│                                                         │
│ 2. Calculate data range: [X, Y)  (left-closed, right-open)│
│                                                         │
│ 3. Issue single I/O: read(X, Y-X)                        │
│                                                         │
│ 4. Decode Row N data within this range                   │
└─────────────────────────────────────────────────────────┘

Example: Accessing Row 100
  rep_index[100] = 0x1F40  (Row 100 start)
  rep_index[101] = 0x1F58  (Row 101 start)
  → Read range: [0x1F40, 0x1F58) = 24 bytes
```

**Storage Method**:

| Encoding Type | Repetition Index Storage Location | Structure |
|--------------|-----------------------------------|-----------|
| **MiniBlock** | Embedded in Page metadata | 2 bytes compact format per chunk |
| **FullZip** | Independent data buffer | `Vec<u64>` offset array |

**IOPS Guarantee**:
- **Fixed-width types**: 1 IOP (offset calculated directly)
- **Variable-width types**: 2 IOPs (read repetition index first, then data)
- **Nested data**: Still maintains 1-2 IOPs (regardless of nesting depth)

> **Note**: There is no size-based threshold switching logic. The repetition index storage method for MiniBlock and FullZip is determined by the **encoding type itself**, not based on index size.

---

## Chapter 6: Write Flow Detailed Explanation

### 6.0 Overall Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Write Path                                        │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌─────────────┐
│ RecordBatch │───→│ BatchEncoder │───→│ FieldEncoder│───→│    Page     │
│  (Arrow)    │    │ (Logical)    │    │ (Physical)  │    │ (8MB block) │
└─────────────┘    └──────────────┘    └─────────────┘    └──────┬──────┘
                                                                  │
                                                                  ▼
                    ┌──────────────────────────────────────────────────────┐
                    │                    FileWriter                        │
                    │  ┌─────────────┐    ┌─────────────┐    ┌──────────┐  │
                    │  │  Data Pages │    │ PageMetadata│───→│  Spill   │  │
                    │  │ (Column Data)│   │ (Page Meta) │    │(Big File)│  │
                    │  └──────┬──────┘    └─────────────┘    └──────────┘  │
                    │         │                                           │
                    │         ▼                                           │
                    │  ┌────────────────────────────────────────────────┐  │
                    │  │              File Layout Writing               │  │
                    │  │  ┌─────────────┐ ┌─────────────┐ ┌──────────┐  │  │
                    │  │  │Data Section │ │GlobalBuffers│ │Metadata  │  │  │
                    │  │  │ (Column)    │ │  (Schema)   │ │(CMO/GBO) │  │  │
                    │  │  └─────────────┘ └─────────────┘ └────┬─────┘  │  │
                    │  └────────────────────────────────────────┼───────┘  │
                    │                                           │          │
                    │  ┌────────────────────────────────────────┼───────┐  │
                    │  │ Footer (40 bytes)                     │       │  │
                    │  │  ├─ column_meta_start: u64 ◄──────────┘       │  │
                    │  │  ├─ global_buff_offsets_start: u64 ◄──────────┤  │
                    │  │  ├─ num_columns, num_global_buffers           │  │
                    │  │  └─ version + Magic                           │  │
                    │  └────────────────────────────────────────────────┘  │
                    └──────────────────────────────────────────────────────┘
                                                                  │
                                                                  ▼
                                                           ┌────────────┐
                                                           │  .lance    │
                                                           │   File     │
                                                           └────────────┘
```

**Key Data Flow Description**:

| Phase | Component | Input | Output | Key Operation |
|-------|-----------|-------|--------|---------------|
| **Logical Encoding** | BatchEncoder | RecordBatch | EncodedBatch | Arrow Array → DataBlock |
| **Physical Encoding** | FieldEncoder | DataBlock | Page | Mini-block/Full Zip encoding |
| **Page Management** | FileWriter | Page | File offset | Allocate buffer, 64-byte alignment |
| **Metadata Collection** | PageMetadata | Page info | ColumnMetadata | Buffer offset, encoding description |
| **File Writing** | Writer | All components | .lance | Write each Section in order |

---

### 6.1 FileWriter Architecture

```rust
// lance-file/src/writer.rs:207
pub struct FileWriter {
    writer: Box<dyn Writer>,                    // Underlying writer
    schema: Option<LanceSchema>,                // Schema
    column_writers: Vec<Box<dyn FieldEncoder>>, // Column encoders
    column_metadata: Vec<pbfile::ColumnMetadata>, // Column metadata
    rows_written: u64,                          // Rows written
    global_buffers: Vec<(u64, u64)>,            // Global buffers
    options: FileWriterOptions,                 // Write options
    page_spill: Option<PageSpillState>,         // Metadata spill (memory optimization)
}
```

**Write Options** (`FileWriterOptions`):

```rust
pub struct FileWriterOptions {
    /// Data cache bytes per column (default 8MB)
    pub data_cache_bytes: Option<u64>,
    /// Maximum page size hint
    pub max_page_bytes: Option<u64>,
    /// Whether to keep original array (memory optimization)
    pub keep_original_array: Option<bool>,
    /// Encoding strategy
    pub encoding_strategy: Option<Arc<dyn FieldEncodingStrategy>>,
    /// File format version
    pub format_version: Option<LanceFileVersion>,
}
```

### 6.2 Write Flow Steps

```rust
impl FileWriter {
    /// Main write loop
    pub async fn write(&mut self, batch: RecordBatch) -> Result<()> {
        // 1. Encode RecordBatch → EncodedBatch
        let encoded = self.encoder.encode_batch(&batch)?;
        
        // 2. Distribute encoded data to column buffers
        for (col_idx, column_data) in encoded.columns.into_iter().enumerate() {
            self.column_buffers[col_idx].push(column_data);
            
            // 3. Check if page needs flushing (default 8MB)
            if self.column_buffers[col_idx].size() >= self.page_size_threshold {
                self.flush_column_page(col_idx).await?;
            }
        }
        
        self.num_rows += batch.num_rows() as u64;
        Ok(())
    }
    
    /// Flush column page to disk
    async fn flush_column_page(&mut self, col_idx: usize) -> Result<()> {
        let column_buffer = &mut self.column_buffers[col_idx];
        
        // 1. Serialize page data
        let page_data = column_buffer.to_page_data();
        
        // 2. Write to data buffer (64-byte aligned)
        let buffer_start = self.writer.tell().await?;
        self.write_aligned(&page_data.data).await?;
        
        // 3. Record page metadata
        let page_meta = pbfile::column_metadata::Page {
            buffer_offsets: vec![buffer_start],
            buffer_sizes: vec![page_data.data.len() as u64],
            length: page_data.num_rows,
            encoding: Some(page_data.encoding),
            priority: page_data.first_row_num,
        };
        
        // 4. Add to column metadata
        self.column_metadatas[col_idx].pages.push(page_meta);
        
        // 5. Clear column buffer
        column_buffer.clear();
        
        Ok(())
    }
    
    /// Complete writing, write Footer
    pub async fn finish(mut self) -> Result<()> {
        // 1. Flush all remaining column buffers
        for col_idx in 0..self.column_buffers.len() {
            if !self.column_buffers[col_idx].is_empty() {
                self.flush_column_page(col_idx).await?;
            }
        }
        
        // 2. Write global buffers (including Schema)
        let global_buffer_start = self.writer.tell().await?;
        let schema_bytes = self.serialize_schema()?;
        self.write_aligned(&schema_bytes).await?;
        
        // 3. Write column metadata
        let column_meta_start = self.writer.tell().await?;
        for col_meta in &self.column_metadatas {
            self.write_protobuf_message(col_meta).await?;
        }
        
        // 4. Write CMO table
        let cmo_table_start = self.writer.tell().await?;
        for col_meta in &self.column_metadatas {
            self.write_u64(col_meta.position).await?;
            self.write_u64(col_meta.size).await?;
        }
        
        // 5. Write GBO table
        let gbo_table_start = self.writer.tell().await?;
        self.write_u64(global_buffer_start).await?;
        self.write_u64(schema_bytes.len() as u64).await?;
        
        // 6. Write Footer (40 bytes)
        self.write_footer(
            column_meta_start,
            cmo_table_start,
            gbo_table_start,
        ).await?;
        
        Ok(())
    }
}
```

---


## Chapter 7: Read Flow Detailed Explanation

### 7.0 Overall Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Read Path                                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌────────────┐
│  .lance    │
│   File     │
└─────┬──────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FileReader                                     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  1. Read Footer (40 bytes) - Single I/O                                 │ │
│  │     └─ Get: CMO/GBO positions, version, column count                   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                          │
│                                    ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  2. Read GBO (Global Buffer Offset) - Single I/O                        │ │
│  │     └─ Global Buffer #0: FileDescriptor (Protobuf)                     │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                          │
│                                    ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  3. Read CMO (Column Metadata Offset) - Single I/O                      │ │
│  │     └─ Position and size of each column's metadata                     │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                          │
│                                    ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  4. Read ColumnMetadata on demand (projected columns) - N I/Os          │ │
│  │     └─ Page list, encoding info, repetition index position per column  │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                          │
└────────────────────────────────────┼──────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Read Request (Random Access)                        │
│                                                                              │
│   Input: row_indices = [100, 200, 300], column_indices = [0, 2]              │
│                                     │                                        │
│                                     ▼                                        │
│   ┌───────────────────────────────────────────────────────────────────────┐  │
│   │  5. Locate Page (based on row_indices)                                │  │
│   │     ├─ Page 0: rows [0..1000)  ← Row 100 in this page                 │  │
│   │     └─ Page 1: rows [1000..2000)                                     │  │
│   └───────────────────────────────────────────────────────────────────────┘  │
│                                     │                                         │
│                                     ▼                                         │
│   ┌───────────────────────────────────────────────────────────────────────┐  │
│   │  6. Calculate Byte Range (using Repetition Index)                     │  │
│   │     ├─ rep_index[100] = 0x1F40  (Row 100 start offset)                │  │
│   │     ├─ rep_index[101] = 0x1F58  (Row 101 start offset)                │  │
│   │     └─ Read range: [0x1F40, 0x1F58) = 24 bytes                        │  │
│   └───────────────────────────────────────────────────────────────────────┘  │
│                                     │                                         │
│                                     ▼                                         │
│   ┌───────────────────────────────────────────────────────────────────────┐  │
│   │  7. Submit I/O Request (via I/O Scheduler)                            │  │
│   │     ├─ Merge overlapping ranges                                       │  │
│   │     ├─ Priority sorting                                               │  │
│   │     └─ Concurrent execution (default 128 IOPS)                        │  │
│   └───────────────────────────────────────────────────────────────────────┘  │
│                                     │                                         │
│                                     ▼                                         │
│   ┌───────────────────────────────────────────────────────────────────────┐  │
│   │  8. Decode Data (FieldDecoder)                                        │  │
│   │     ├─ Full Zip: Decode Control Word → Parse Rep/Def → Extract values │  │
│   │     ├─ Mini-block: Decompress chunk → Decode values                   │  │
│   │     └─ Apply projection (only return requested columns)               │  │
│   └───────────────────────────────────────────────────────────────────────┘  │
│                                     │                                       │
│                                     ▼                                       │
│                           ┌─────────────┐                                   │
│                           │ RecordBatch │                                   │
│                           │  (Arrow)    │                                   │
│                           └─────────────┘                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**I/O Count Analysis**:

| Step | Operation | IOPS | Description |
|------|-----------|------|-------------|
| 1 | Read Footer | 1 | Required for all reads |
| 2 | Read GBO | 1 | Can be cached |
| 3 | Read CMO | 1 | Can be cached |
| 4 | Read ColumnMetadata | N | N = projected columns, can be cached |
| 5-8 | Read actual data | 1-2 | 1-2 times per column per page (1 for fixed-width, 2 for variable-width) |

**Cache Optimization**:
- `CachedFileMetadata` caches results of steps 1-4
- Multiple reads of the same file only need to execute steps 5-8
- Typical random access: First time **4 + 2×columns** IOPS, subsequent **2×columns** IOPS

---

### 7.1 FileReader Architecture

```rust
// lance-file/src/reader.rs:347
#[derive(Debug)]
pub struct FileReader {
    scheduler: Arc<dyn EncodingsIo>,      // I/O scheduler
    base_projection: ReaderProjection,    // Column projection
    num_rows: u64,                        // Total rows
    metadata: Arc<CachedFileMetadata>,    // Cached metadata
    decoder_plugins: Arc<DecoderPlugins>, // Decoder plugins
    cache: Arc<LanceCache>,               // Cache
    options: FileReaderOptions,           // Read options
}

pub struct CachedFileMetadata {
    pub file_schema: Arc<Schema>,                    // File Schema
    pub column_metadatas: Vec<pbfile::ColumnMetadata>, // Column metadata
    pub column_infos: Vec<Arc<ColumnInfo>>,          // Column info
    pub num_rows: u64,                               // Row count
    pub file_buffers: Vec<BufferDescriptor>,         // Global buffer descriptors
    pub num_data_bytes: u64,                         // Data bytes
    pub num_column_metadata_bytes: u64,              // Column metadata bytes
    pub num_global_buffer_bytes: u64,                // Global buffer bytes
    pub num_footer_bytes: u64,                       // Footer bytes
    pub major_version: u16,
    pub minor_version: u16,
}
```

### 7.2 File Open Flow

```rust
impl FileReader {
    pub async fn open(
        object_store: Arc<ObjectStore>,
        path: &Path,
    ) -> Result<Self> {
        // 1. Read Footer (last 40 bytes, including Magic)
        let file_size = reader.size().await?;
        let footer_bytes = reader.get_range(file_size - 40..file_size).await?;
        let footer = parse_footer(&footer_bytes)?;
        
        // 2. Read CMO table
        // Note: CMO table is written before GBO table, so CMO range is [cmo_table_pos, gbo_table_pos)
        let cmo_table_bytes = reader.get_range(
            footer.cmo_table_pos..footer.gbo_table_pos
        ).await?;
        let column_metadata_positions = parse_cmo_table(&cmo_table_bytes)?;
        
        // 3. Read GBO table
        // Note: GBO table is written before Footer, so GBO range is [gbo_table_pos, footer_pos)
        let gbo_table_bytes = reader.get_range(
            footer.gbo_table_pos..footer.footer_pos
        ).await?;
        let global_buffer_descriptors = parse_gbo_table(&gbo_table_bytes)?;
        
        // 4. Read global buffer #0 (Schema)
        let schema_buffer = read_global_buffer(
            &reader,
            &global_buffer_descriptors[0]
        ).await?;
        let schema = deserialize_arrow_schema(&schema_buffer)?;
        
        // 5. Read all column metadata
        let mut column_metadatas = Vec::new();
        for (pos, size) in column_metadata_positions {
            let meta_bytes = reader.get_range(pos..pos + size).await?;
            let meta = pbfile::ColumnMetadata::decode(&meta_bytes[..])?;
            column_metadatas.push(meta);
        }
        
        // 6. Create I/O scheduler
        let scheduler = Arc::new(FileScheduler::new(reader));
        
        // 7. Build ColumnInfo (includes decoders)
        let column_infos = build_column_infos(
            &schema,
            &column_metadatas,
            &scheduler,
        )?;
        
        Ok(Self {
            metadata: Arc::new(CachedFileMetadata {
                file_schema: Arc::new(schema),
                column_metadatas,
                column_infos,
                num_rows: footer.num_rows,
                // ...
            }),
            scheduler,
            // ...
        })
    }
}
```

### 7.3 Random Access Read

```rust
impl FileReader {
    /// Random access: Read specified rows and columns
    pub async fn random_access(
        &self,
        row_indices: &[u64],
        column_indices: &[u32],
    ) -> Result<RecordBatch> {
        // 1. Schedule I/O requests for each column
        let mut decode_tasks = Vec::new();
        
        for &col_idx in column_indices {
            let col_info = &self.metadata.column_infos[col_idx];
            
            // 2. Find corresponding page based on row number
            let pages = find_pages_for_rows(
                &col_info.metadata.pages,
                row_indices,
            );
            
            // 3. Calculate byte ranges using repetition index
            let byte_ranges = calculate_byte_ranges(
                &pages,
                row_indices,
                col_info.rep_index.as_ref(),
            );
            
            // 4. Submit I/O request (with priority)
            let task = col_info.scheduler.schedule_ranges(
                &byte_ranges,
                priority = row_indices[0],  // Lowest row number has highest priority
            );
            
            decode_tasks.push(task);
        }
        
        // 5. Wait for all I/O to complete and decode
        let mut arrays = Vec::new();
        for (task, &col_idx) in decode_tasks.into_iter().zip(column_indices) {
            let decoded_data = task.await?;
            let array = self.decode_column(col_idx, decoded_data)?;
            arrays.push(array);
        }
        
        // 6. Assemble RecordBatch
        let schema = self.metadata.file_schema.project(column_indices)?;
        Ok(RecordBatch::try_new(Arc::new(schema), arrays)?)
    }
}
```

### 7.4 I/O Scheduling Optimization

```rust
// lance-io/src/scheduler.rs
pub struct FileScheduler {
    // Concurrency control
    iops_quota: Semaphore,         // Global IOPS limit (default 128)
    bytes_quota: AtomicI64,        // Bytes quota
    
    // Request queue
    pending_requests: Mutex<BinaryHeap<IoTask>>,
    
    // Statistics
    iops_counter: AtomicU64,
}

struct IoTask {
    ranges: Vec<Range<u64>>,       // Requested byte ranges
    priority: u64,                 // Priority (row number, lower is higher)
    completion_tx: OneshotSender<Result<Vec<Bytes>>>,
}

impl FileScheduler {
    pub async fn schedule_ranges(
        &self,
        ranges: &[Range<u64>],
        priority: u64,
    ) -> Result<Vec<Bytes>> {
        // 1. Acquire IOPS quota
        let _permit = self.iops_quota.acquire().await?;
        
        // 2. I/O Coalescing
        let coalesced_ranges = self.coalesce_ranges(ranges);
        
        // 3. Create I/O task
        let (tx, rx) = oneshot::channel();
        let task = IoTask {
            ranges: coalesced_ranges,
            priority,
            completion_tx: tx,
        };
        
        // 4. Add to priority queue
        self.pending_requests.lock().push(task);
        
        // 5. Background I/O loop processes requests
        // High priority requests may jump ahead
        
        // 6. Wait for result
        rx.await?
    }
    
    fn coalesce_ranges(&self, ranges: &[Range<u64>]) -> Vec<Range<u64>> {
        // 1. Sort by starting position
        // 2. Merge overlapping/adjacent ranges
        // 3. Split oversized ranges (>8MB)
        // Return optimized range list
    }
}
```

---



## Chapter 8: Page Management and Memory Optimization

### 8.1 Page Buffer Alignment

```rust
// lance-file/src/writer.rs
pub(crate) const PAGE_BUFFER_ALIGNMENT: usize = 64;  // 64-byte alignment
```

**Why 64-byte alignment?**
1. **SIMD Friendly**: Modern CPU SIMD instructions typically require 64-byte alignment
2. **Cache Line**: Matches CPU cache line size (typically 64 bytes)
3. **Direct I/O**: Some scenarios require sector alignment

### 8.2 Page Size Strategy

```rust
const MAX_PAGE_BYTES: usize = 32 * 1024 * 1024;  // 32MB (V2.0)
// V2.1+ no longer limits at write time, splits at read time instead

pub const DEFAULT_READ_CHUNK_SIZE: u64 = 8 * 1024 * 1024;  // 8MB
```

| Version | Write Strategy | Read Strategy |
|---------|---------------|---------------|
| V2.0 | Split at write time (max 32MB) | Direct read |
| V2.1+ | Allow large pages (no limit) | Split into 8MB chunks at read time |

**Advantages of V2.1+ Improvement**:
- No need to flush frequently during writing
- Load on demand during reading, controlling memory usage
- Avoid read amplification caused by small pages

### 8.3 Metadata Spill (PageMetadataSpill)

**Problem Scenario**: During IVF Shuffle with thousands of partition writers, a large amount of page metadata accumulates in memory

**Solution**:

```rust
// lance-file/src/writer.rs:115-200
struct PageMetadataSpill {
    writer: Box<dyn Writer>,              // Spill file writer
    path: Path,
    position: u64,
    
    // Serialized page metadata buffer per column
    column_buffers: Vec<Vec<u8>>,
    
    // Block indices already spilled to disk
    column_chunks: Vec<Vec<(u64, u32)>>,
    
    // Buffer limit per column
    per_column_limit: usize,
}

impl PageMetadataSpill {
    async fn append_page(
        &mut self,
        column_idx: usize,
        page: &pbfile::column_metadata::Page,
    ) -> Result<()> {
        // 1. Serialize page metadata
        let page_bytes = page.encode_to_vec();
        
        // 2. Add to column buffer
        self.column_buffers[column_idx].extend_from_slice(&page_bytes);
        
        // 3. Check if spill is needed
        if self.column_buffers[column_idx].len() >= self.per_column_limit {
            self.flush_column_buffer(column_idx).await?;
        }
        
        Ok(())
    }
    
    async fn flush_column_buffer(&mut self, col_idx: usize) -> Result<()> {
        // 1. Write to temp file
        let chunk_start = self.position;
        let chunk_len = self.column_buffers[col_idx].len() as u32;
        self.writer.write_all(&self.column_buffers[col_idx]).await?;
        
        // 2. Record block position
        self.column_chunks[col_idx].push((chunk_start, chunk_len));
        
        // 3. Clear buffer
        self.column_buffers[col_idx].clear();
        
        Ok(())
    }
}
```

**Memory Optimization Effect**: Reduced from O(page count) to O(column count × buffer size)

---



## Chapter 9: Version Evolution

### 9.1 Version Enumeration

```rust
// lance-encoding/src/version.rs
pub enum LanceFileVersion {
    Legacy,      // 0.1 old format
    #[default]
    V2_0,        // Default version
    Stable,      // Points to V2_0
    V2_1,        // Introduces Full Zip / Mini-block
    V2_2,        // Extensions
    Next,        // Unstable version (V2_3)
    V2_3,        // Latest unstable
}
```

### 9.2 Version Mapping

| Version Alias | Major | Minor | Key Features | lance-encoding Version |
|---------------|-------|-------|--------------|------------------------|
| Legacy | 0 | 1-2 | Old format, deprecated | pre-2.0 |
| V2_0 | 0 | 3 | First stable version, ArrayEncoding | 2.0.x |
| V2_0 | 2 | 0 | Version number normalization, equivalent to 0.3 | 2.0.x |
| **V2_1** | **2** | **1** | **Major update: Full Zip + Mini-block structural encoding** | **2.1.x** |
| V2_2 | 2 | 2 | Large chunk Miniblock, ConstantLayout optimization | 2.2.x |
| V2_3 / Next | 2 | 3 | Latest development version (unstable) | 2.3.x+ |

**Version Detection** (`lance-file/src/lib.rs`):

```rust
pub async fn determine_file_version(...) -> Result<LanceFileVersion> {
    // Read last 8 bytes of file
    let footer = reader.get_range((size - 8)..size).await?;
    
    // Check Magic: "LANC"
    if &footer[4..] != MAGIC {
        return Err(...); // Not a Lance file
    }
    
    // Parse version number
    let major_version = u16::from_le_bytes([footer[0], footer[1]]);
    let minor_version = u16::from_le_bytes([footer[2], footer[3]]);
    
    LanceFileVersion::try_from_major_minor(major_version as u32, minor_version as u32)
}
```

### 9.3 v2.0 vs v2.1 Key Differences

| Feature | v2.0 | v2.1 |
|---------|------|------|
| **Structural Encoding** | Single strategy (ArrayEncoding) | Adaptive (Full Zip / Mini-block) |
| **Repetition Index** | ❌ Not supported | ✅ Supported, enables efficient random access |
| **Column Projection** | Requires all structural field IDs | Only needs leaf field IDs |
| **Encoding Extension** | Hard-coded | Plugin system |
| **Page Size** | Split at write time (max 32MB) | Dynamic, split at read time |
| **Nested Handling** | Complex | Transparent (Rep-Def + Full Zip) |



---

## Chapter 10: Performance Optimization Techniques

### 10.1 Zero-Copy Path

```rust
// Zero-copy read when conditions are met
fn try_zero_copy_decode(data: &[u8]) -> Option<Buffer> {
    // Conditions:
    // 1. Fixed-width data type
    // 2. Bit width is multiple of 8 (no unpacking needed)
    // 3. No transparent compression used
    
    if is_byte_aligned(data) && !is_bitpacked(data) {
        // Directly wrap as Arrow Buffer
        Some(Buffer::from_vec(data.to_vec()))
    } else {
        None  // Needs decoding
    }
}
```

### 10.2 SIMD Acceleration

> **Note**: Lance actually uses cross-platform SIMD abstractions rather than writing intrinsics directly.

Lance implements cross-architecture SIMD abstraction layer in `lance-linalg/src/simd/`:

```rust
// lance-linalg/src/simd/f32.rs

/// SIMD type for 8 f32 values (256-bit)
#[cfg(target_arch = "x86_64")]
pub struct f32x8(std::arch::x86_64::__m256);

#[cfg(target_arch = "aarch64")]
pub struct f32x8(float32x4x2_t);

impl f32x8 {
    /// Gather 8 values (for index lookup)
    #[inline]
    pub fn gather(slice: &[f32], indices: &[i32; 8]) -> Self {
        #[cfg(target_arch = "x86_64")]
        unsafe {
            let idx = i32x8::from(indices);
            Self(_mm256_i32gather_ps::<4>(slice.as_ptr(), idx.0))
        }
        
        #[cfg(target_arch = "aarch64")]
        unsafe {
            // aarch64 falls back to scalar implementation
            let ptr = slice.as_ptr();
            let values = [
                *ptr.add(indices[0] as usize),
                // ...
            ];
            Self::load_unaligned(values.as_ptr())
        }
    }
}
```

**Design Characteristics**:
1. **Cross-platform**: Same API supports x86_64 (AVX2), aarch64 (NEON), loongarch64
2. **Zero-cost abstraction**: Directly wraps SIMD registers, no runtime overhead
3. **Safe encapsulation**: `unsafe` code is limited inside the abstraction layer, providing safe API externally
4. **Arrow integration**: Seamlessly compatible with Arrow's buffer system

**Practical Usage Example** (distance calculation):
```rust
// lance-index/src/vector/pq.rs
fn compute_l2_distance(a: &[f32], b: &[f32]) -> f32 {
    let mut sum = f32x8::zeros();
    for i in (0..a.len()).step_by(8) {
        let va = f32x8::from(&a[i..]);
        let vb = f32x8::from(&b[i..]);
        let diff = va - vb;
        sum += diff * diff;
    }
    sum.reduce_sum()
}
```

### 10.3 Parallel Decoding

```rust
use rayon::prelude::*;

fn decode_columns_parallel(
    encoded_columns: Vec<EncodedColumn>,
) -> Vec<ArrayRef> {
    encoded_columns
        .par_into_iter()  // Parallel iteration
        .map(|col| decode_column(col))
        .collect()
}
```

### 10.4 Metadata Caching

```rust
// CachedFileMetadata is wrapped in Arc, shared by multiple readers
metadata: Arc<CachedFileMetadata>
```

**Benefit**: Multiple reads of the same file share metadata, reducing I/O

### 10.5 Projection Pushdown

```rust
pub struct ReaderProjection {
    pub schema: Arc<Schema>,       // Projected Schema
    pub column_indices: Vec<u32>,  // Column indices to read
}
```

**Benefit**: Only read required columns, reducing I/O and memory


---

## Chapter 11: Comparison with Other Formats

### 11.1 Complete Comparison Table

| Feature | Parquet | ORC | Lance |
|---------|---------|-----|-------|
| **Type System** | Thrift-defined | Protobuf-defined | External (Arrow) |
| **Schema Location** | SchemaElement in Footer | Type[] in Footer | Global Buffer #0 |
| **Data Layout** | Row Group → Column Chunk → Page | Stripe → Column | Column → Page → Buffer |
| **Random Access** | Page offset index | Index at file tail | Repetition Index (2 IOPS) |
| **Nested Support** | Rep-Def Levels | Similar to Parquet | Rep-Def + Full Zip |
| **Compression Granularity** | Page level | Stripe level | Page/value level |
| **Encoding Extension** | ❌ Requires spec change | ❌ Requires spec change | ✅ Plugin system |
| **Vector Search** | ❌ Not supported | ❌ Not supported | ✅ Native support |
| **MVCC** | ❌ Not supported | ❌ Not supported | ✅ Table format layer support |

### 11.2 File Size and Performance Comparison

> **Note**: The following performance data is **estimated** for order-of-magnitude comparison. Actual performance highly depends on hardware (NVMe SSD), data characteristics, and query patterns.

For the same dataset (1 million rows, 128-dimensional vectors + metadata):

| Format | File Size | Compression Ratio | Random Access Throughput* |
|--------|-----------|-------------------|--------------------------|
| Parquet | 2.1 GB | 3.2x | ~5,500 rows/sec (default) / ~350K rows/sec (optimized) |
| ORC | 2.3 GB | 3.0x | Similar to Parquet |
| Lance v2.0 | 1.9 GB | 3.5x | ~350,000 rows/sec |
| Lance v2.1 | 1.8 GB | 3.7x | ~400,000 rows/sec |

**Data Sources**:
- Parquet optimized configuration (8KB page size + disabled dictionary): 350,000 rows/sec (Lance paper Table 2)
- Lance v2.1: 400,000 values/sec random access (paper Section 4.2)

*Random access throughput: Single-threaded, NVMe SSD, 4KB reads


---

## Chapter 12: Source Code Location Reference

### 12.1 File Format Layer Core Files

| File | Path | Description |
|------|------|-------------|
| `reader.rs` | `lance-file/src/reader.rs` | File reading, Footer parsing |
| `writer.rs` | `lance-file/src/writer.rs` | File writing, page management |
| `lib.rs` | `lance-file/src/lib.rs` | Version detection, file opening |
| `format.rs` | `lance-file/src/format.rs` | Constant definitions (MAGIC, version numbers) |
| `traits.rs` | `lance-file/src/traits.rs` | Reader/Writer trait |

### 12.2 Encoding Layer Core Files

| File | Path | Description |
|------|------|-------------|
| `miniblock.rs` | `lance-encoding/src/encodings/logical/primitive/miniblock.rs` | Mini-block encoding implementation |
| `primitive.rs` | `lance-encoding/src/encodings/logical/primitive.rs` | Full Zip encoding, repetition index |
| `version.rs` | `lance-encoding/src/version.rs` | LanceFileVersion enum |
| `encoding.rs` | `lance-encoding/src/encoding.rs` | FieldEncoder trait |

### 12.3 I/O Layer Core Files

| File | Path | Description |
|------|------|-------------|
| `scheduler.rs` | `lance-io/src/scheduler.rs` | I/O scheduler |
| `object_store.rs` | `lance-io/src/object_store.rs` | Object store abstraction |

### 12.4 Protobuf Definitions

| File | Path | Description |
|------|------|-------------|
| `file2.proto` | `protos/file2.proto` | File format definitions (Footer, Page, ColumnMetadata) |
| `encodings_v2_1.proto` | `protos/encodings_v2_1.proto` | Structural encoding definitions (MiniBlockLayout, FullZipLayout) |

### 12.5 Key Code Locations

| Functionality | Code Location | Line Number |
|---------------|---------------|-------------|
| Footer reading | `lance-file/src/reader.rs` | ~373 |
| Footer size constant | `lance-file/src/reader.rs` | `FOOTER_LEN: usize = 40` |
| Version detection | `lance-file/src/lib.rs` | `determine_file_version` |
| FileWriter | `lance-file/src/writer.rs` | ~207 |
| MiniBlockCompressor | `lance-encoding/src/encodings/logical/primitive/miniblock.rs` | - |
| FullZipEncoder | `lance-encoding/src/encodings/logical/primitive.rs` | - |
| Repetition Index | `lance-encoding/src/encodings/logical/primitive.rs` | ~1164-1250 |
| PageMetadataSpill | `lance-file/src/writer.rs` | ~115-200 |



---

## Chapter 13: Summary and Design Insights

### 13.1 Core Innovations of Lance File Format

1. **Type-less System Design**:
   - Files only store raw byte buffers
   - Schema is stored in FileDescriptor (Global Buffer #0)
   - Encoding strategies are completely decoupled

2. **Adaptive Structural Encoding**:
   - Mini-block: Small data, vectorization optimized (4-8KB chunks)
   - Full Zip: Large data, random access optimized (row-major + Control Word)
   - Automatically selected based on data characteristics

3. **Repetition Index Mechanism**:
   - O(1) complexity row positioning
   - Supports shallow access to nested data
   - 2 IOPS guarantee (1 for fixed-width, 2 for variable-width)

4. **Pluggable Encoding System**:
   - Encoders/decoders can be dynamically registered
   - No need to modify file format
   - Supports experimental encodings

5. **Memory Efficiency Design**:
   - PageMetadataSpill prevents memory explosion when writing large files
   - Metadata cache sharing
   - V2.1+ splits into chunks when reading

### 13.2 Design Trade-offs

| Advantage | Cost |
|-----------|------|
| Excellent random access performance | Requires more memory buffering during writing |
| Flexible encoding strategies | Increased decoder complexity |
| Zero-copy potential | Requires additional metadata management |
| No type coupling | Difficult to use outside Arrow ecosystem |
| Cloud-native design | Extra overhead in small file scenarios |

### 13.3 Rationale for Key Design Decisions

**Why Protobuf?**
1. Forward/backward compatibility: Adding/removing fields doesn't affect old versions
2. Cross-language: Auto-generates multi-language bindings
3. Compact: Binary format, small size
4. Flexible: Any type supports extended encoding

**Why is Footer at the end of the file?**
1. Streaming write: Can write without knowing total file size
2. Fast open: Only need to read last 8 bytes to get version and metadata positions
3. Extensible: Metadata size can vary without affecting read logic

**Why Global Buffers?**
1. Schema sharing: Entire file shares one Schema
2. Dictionary sharing: Dictionary-encoded columns can share dictionaries
3. Custom metadata: User-defined key-value storage

### 13.4 Applicable Scenarios

**Lance is Best Suited For**:
- ✅ Workloads requiring frequent random access
- ✅ Storing vector embeddings and multimodal data
- ✅ Hybrid queries combining analytics and search
- ✅ Cloud-native environments (object storage)
- ✅ Transactional workloads requiring MVCC

**Not Suitable For**:
- ❌ Pure batch analytics (Parquet is sufficient with more mature ecosystem)
- ❌ Non-Arrow ecosystem
- ❌ Extremely resource-constrained environments
- ❌ Scenarios with frequent small file creation

### 13.5 Future Directions

Based on the paper and source code comments:

1. **Deep io_uring Integration**: Further reduce system call overhead
2. **Smarter I/O Scheduling**: Machine learning-based prefetching
3. **Incremental Compaction**: LSM-like background merging
4. **More Encoding Plugins**: Optimizations for specific data types
5. **GPU Decoding**: Vector data directly to GPU

---

## Chapter 14: Error Handling and Edge Cases

### 14.1 Common Error Scenarios

| Error Type | Trigger Condition | Handling Method | Returned Error |
|------------|-------------------|-----------------|----------------|
| **InvalidMagic** | File tail Magic is not "LANC" | Reject immediately | `Error::InvalidMagic` |
| **VersionMismatch** | Major/Minor version not in support list | Reject opening | `Error::UnsupportedVersion` |
| **CorruptedFooter** | Footer parsing failed (insufficient length/field out of bounds) | Log and return | `Error::IoError` |
| **MissingColumn** | Projected column index out of range | Check in advance | `Error::IndexOutOfBounds` |
| **ChecksumMismatch** | Data checksum failed (if checksum enabled) | Retry or report error | `Error::Corruption` |
| **OutOfMemory** | Page data exceeds available memory | Read in chunks | `Error::OutOfMemory` |

### 14.2 Edge Case Handling

#### 1. Empty File (0 rows)

```rust
// Allow creating empty files
FileWriter::finish() -> {
    num_rows: 0,
    num_columns: schema.num_fields(),  // Column count determined by Schema, not 0
    pages: [],  // Empty page list
}
```

**Handling Strategy**:
- ✅ Allow creating empty files (contains only Footer + Schema)
- ✅ Return empty RecordBatch when reading (correct schema, 0 rows)
- ❌ Do not write any data pages

#### 2. Oversized Pages (> 1GB)

**Problem**: Single page with too much data may cause memory allocation failure

**Handling Strategy** (V2.1+):
```rust
// reader.rs: Automatic chunking when reading
const DEFAULT_READ_CHUNK_SIZE: u64 = 8 * 1024 * 1024;  // 8MB

if page_size > DEFAULT_READ_CHUNK_SIZE {
    // Logically split large page into multiple 8MB read requests
    let chunks = split_page_into_chunks(page, DEFAULT_READ_CHUNK_SIZE);
    for chunk in chunks {
        scheduler.schedule_read(chunk.offset, chunk.size).await?;
    }
}
```

**Guarantees**:
- Single memory allocation does not exceed 8MB (configurable)
- Large pages will not cause OOM
- Read performance is not significantly affected

#### 3. Excessive Nesting Depth (> 100 levels)

**Limitations**:
- Rep-Def levels use `u16` storage, theoretically supporting up to **32767** nesting levels
- Actually limited by:
  - Stack space (recursive decoding)
  - Control Word size (`bits_rep + bits_def` must be ≤ 64)

**Handling Strategy**:
```rust
fn validate_nested_depth(depth: usize) -> Result<()> {
    const MAX_RECOMMENDED_DEPTH: usize = 100;
    if depth > u16::MAX as usize {
        return Err(Error::Unsupported("Nested depth exceeds u16 limit"));
    }
    if depth > MAX_RECOMMENDED_DEPTH {
        warn!("Nested depth {} exceeds recommended limit {}", depth, MAX_RECOMMENDED_DEPTH);
    }
    Ok(())
}
```

#### 4. Extreme Column Width (single column > 1 million fields)

**Scenario**: Ultra-wide tables (e.g., wide feature vectors)

**Handling Strategy**:
```rust
// During writing
if schema.num_fields() > 100_000 {
    // Enable metadata spill to prevent memory explosion
    writer_options.enable_page_metadata_spill = true;
}

// During reading
if projection_indices.len() > 10_000 {
    // Read column metadata in batches to avoid loading all at once
    read_column_metadata_in_batches(&cmo_table, batch_size = 1000)?;
}
```

#### 5. Network Interruption (object storage scenarios)

**Retry Strategy**:
```rust
// lance-io/src/object_store.rs
const MAX_RETRIES: u32 = 3;
const RETRY_DELAY_MS: u64 = 100;

async fn read_with_retry(
    store: &ObjectStore,
    path: &Path,
    range: Range<u64>,
) -> Result<Bytes> {
    for attempt in 0..MAX_RETRIES {
        match store.get_range(path, range.clone()).await {
            Ok(data) => return Ok(data),
            Err(e) if attempt < MAX_RETRIES - 1 => {
                warn!("Read failed (attempt {}): {}, retrying...", attempt + 1, e);
                tokio::time::sleep(Duration::from_millis(RETRY_DELAY_MS * 2_u64.pow(attempt))).await;
            }
            Err(e) => return Err(e.into()),
        }
    }
    unreachable!()
}
```

#### 6. Concurrent Write Conflicts

**Scenario**: Multiple processes writing to the same file simultaneously (not supported, should report error)

```rust
// FileWriter::open() attempts to acquire file lock
pub async fn open(path: &Path) -> Result<FileWriter> {
    // Object storage: relies on storage layer atomicity (e.g., S3 PUT-if-absent)
    // Local files: uses flock
    
    #[cfg(not(target_arch = "wasm32"))]
    {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)  // Error if file already exists
            .open(path)?;
        
        // Attempt to acquire exclusive lock
        if let Err(e) = file.try_lock_exclusive() {
            return Err(Error::AlreadyExists(format!(
                "File {} is locked by another process", path
            )));
        }
    }
    
    Ok(FileWriter { ... })
}
```

### 14.3 Fault Tolerance and Recovery

#### Degraded Reading for Corrupted Metadata

```rust
// Attempt to recover from backup or redundant information
async fn recover_from_corruption(
    reader: &dyn Reader,
    corrupted_offset: u64,
) -> Result<Bytes> {
    // Strategy 1: Try to read redundant replica (if multi-replica enabled)
    if let Some(replica) = find_replica(reader.path()) {
        return replica.get_range(corrupted_offset..corrupted_offset + 4096).await;
    }
    
    // Strategy 2: Skip corrupted page, mark as null
    warn!("Skipping corrupted page at offset {}", corrupted_offset);
    Ok(Bytes::new())  // Return empty data, upper layer fills with null
}
```

#### Transaction Rollback for Failed Writes

```rust
// FileWriter::abort() - Clean up incomplete writes
pub async fn abort(mut self) -> Result<()> {
    // 1. Close writer
    drop(self.writer);
    
    // 2. Delete temp files (if spill files were used)
    if let Some(spill) = self.page_spill {
        spill.cleanup().await?;
    }
    
    // 3. Object storage: Delete uploaded segments
    if self.is_object_store() {
        self.object_store.delete(&self.path).await?;
    }
    
    info!("Aborted write to {}", self.path);
    Ok(())
}
```

---

## References

- Lance Paper: https://arxiv.org/abs/2504.15247
- Format Specification: https://lance.org/format
- Source Repository: https://github.com/lancedb/lance
- Protobuf Definitions:
  - `protos/file2.proto` (File format layer)
  - `protos/encodings_v2_1.proto` (Encoding layer)

---

*This document is a translation of Chapters 1-14 from the original Chinese technical analysis document.*

*Translation based on Lance v3.0.0-rc.3 source code, updated March 2026*
