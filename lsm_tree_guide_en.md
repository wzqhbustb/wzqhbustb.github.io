# LSM-Tree Complete Technical Guide: From Theory to Industrial Practice

> **Author**: Organized based on LSM-Tree classic papers and modern optimizations  
> **Version**: 1.0  
> **Date**: 2026-03-06  
> **Description**: This document systematically organizes the complete technical evolution of LSM-Tree from its theoretical foundation in 1996 to industrial practice in the 2020s

---

## Table of Contents

1. [Overview](#1-overview)
2. [LSM-Tree Theoretical Foundation (1996)](#2-lsm-tree-theoretical-foundation-1996)
3. [LevelDB Engineering Implementation (2011)](#3-leveldb-engineering-implementation-2011)
4. [Comparison Between LevelDB and LSM-Tree Paper](#4-comparison-between-leveldb-and-lsm-tree-paper)
5. [WiscKey Key-Value Separation Optimization (2016)](#5-wisckey-key-value-separation-optimization-2016)
6. [PebblesDB FLSM Optimization (2017)](#6-pebblesdb-flsm-optimization-2017)
7. [RocksDB and Industrial Practice](#7-rocksdb-and-industrial-practice)
8. [LSM-Tree Optimization Technology Map](#8-lsm-tree-optimization-technology-map)
9. [Performance Comparison Summary](#9-performance-comparison-summary)
10. [References and Further Reading](#10-references-and-further-reading)

---

## 1. Overview

### 1.1 What is LSM-Tree

LSM-Tree (Log-Structured Merge-Tree) is a **write-optimized** persistent data structure, specifically designed for high write throughput scenarios. It significantly improves write performance by transforming random writes into sequential writes.

### 1.2 Core Design Philosophy

The design of LSM-Tree revolves around four core principles:

**1. Defer and Batch Processing**
- Write operations are first recorded in memory structures (MemTable), avoiding immediate disk I/O
- When MemTable reaches a certain threshold, it is batch-flushed to disk to form SSTable
- Background Compaction merges and maintains data ordering
- This batch processing amortizes the disk overhead of single writes

**2. Sequential Write Optimization**
- Once SSTable is written, it cannot be modified; only new files can be appended
- All disk operations are sequential writes, fully utilizing disk bandwidth (HDD sequential write can reach 100MB/s+, while random write is only 1MB/s)
- Sacrifice some read performance (need to check multiple levels) in exchange for extreme write performance
- Compensate read performance through Bloom Filter, caching, and other technologies

**3. Multi-Level Hierarchical Structure**
- L0 (Level 0): Memory MemTable + recently flushed immutable files (overlapping allowed)
- L1-LN (Level 1-N): Disk files, each level size increases by a fixed ratio (usually 10 times)
- Data flows from upper levels to lower levels; colder data resides in deeper levels
- Upper levels have small data volume and fast queries; lower levels have large data volume and slower queries but higher storage efficiency

**4. Space for Time**
- Allow data redundancy: multiple versions of the same key may coexist in different levels
- Use write amplification (rewriting data) in exchange for high throughput of sequential I/O
- Use space amplification (temporarily retaining invalid data) in exchange for efficient delete operations (only need to mark Tombstone)

### 1.3 Technology Evolution Timeline

| Year | Milestone | Core Contribution |
|------|-----------|-------------------|
| **1996** | LSM-Tree Paper Published | Theoretical foundation, proposed Rolling Merge, multi-component architecture, cost model |
| **2004** | Google Bigtable | Distributed LSM practice, proving LSM feasibility in large-scale scenarios |
| **2006** | Apache HBase | Open source Bigtable implementation, promoting LSM adoption in Hadoop ecosystem |
| **2008** | Facebook Cassandra | LSM + distributed + decentralized design, supporting multi-data centers |
| **2011** | Google LevelDB | Embedded LSM engine, engineering simplification (SkipList, SSTable), approximately 20K lines of code |
| **2012** | Facebook RocksDB | LevelDB optimization branch, multi-threading, rich features, becoming industrial standard |
| **2014** | MongoDB WiredTiger | Supporting LSM storage engine, providing alternative to B-Tree |
| **2016** | WiscKey Paper | Key-value separation architecture, write amplification reduced to near 1×, suitable for large value scenarios |
| **2017** | PebblesDB Paper | FLSM data structure, reducing write amplification by 4.8× through Guards mechanism |
| **2018** | Titan Open Source | TiKV's key-value separation engine, industrial-grade implementation of WiscKey ideas |
| **2020** | RocksDB Integrated BlobDB | Key-value separation functionality matured, becoming officially recommended solution |
| **2021+** | ZNS SSD / PMem Adaptation | LSM optimizations for new hardware (Zoned Namespace SSD, Persistent Memory) |
| **2024-2026** | RocksDB v10-v11 | HyperClockCache, Interpolation Search, Wide-Column support, and other cutting-edge features |

---

## 2. LSM-Tree Theoretical Foundation (1996)


### 2.1 Core Contributions of the Paper

**Paper**: *The Log-Structured Merge-Tree (LSM-Tree)*  
**Authors**: Patrick O'Neil, Edward Cheng, Dieter Gawlick, Elizabeth O'Neil  
**Published**: Acta Informatica, 1996

#### Problems Solved

Problems of traditional B-Tree in high-write scenarios:
- **Random Writes**: Each insertion requires random disk I/O
- **Index Maintenance Cost**: Real-time indexing doubles transaction I/O cost
- **Write Amplification**: B-Tree updates may require multiple disk writes

#### Core Innovations

**Two-Component Architecture**: LSM-Tree divides storage into memory component C0 and disk component C1.
- C0 resides entirely in memory, supporting fast insertion and query
- C1 resides on disk, organized in multi-page blocks, supporting sequential read/write
- Data migrates progressively from C0 to C1 through Rolling Merge

**Rolling Merge Mechanism**: A gradual data migration process similar to merge sort.
- Batch read C1's multi-page blocks into memory buffer
- Read a continuous segment of entries from C0, merge with data in C1 blocks
- Create new C1 blocks and write to new locations (without overwriting old blocks)
- Cycle repeatedly to achieve continuous data flushing

**Cost Model**: The cost advantage of LSM-Tree over B-Tree stems from differences in disk I/O patterns.
- B-Tree: Random page I/O, each update may trigger multiple disk seeks
- LSM: Multi-page block sequential I/O, batch writes amortize seek costs
- Cost ratio ≈ (Sequential I/O cost / Random I/O cost) × (1 / Merge batch size)

**Two-Component Architecture Diagram**:

                    LSM-Tree Two-Component Architecture
    ┌─────────────────────────────────────────────────────┐
    │                                                     │
    │    C0 Component (Memory)      C1 Component (Disk)      │
    │    ┌──────────────┐            ┌──────────────┐     │
    │    │  Index Structure │         │  Multi-page  │     │
    │    │  (B-Tree)    │            │  Block 1     │     │
    │    ├──────────────┤  Rolling   ├──────────────┤     │
    │    │ Key1: Val1   │  Merge     │  Multi-page  │     │
    │    │ Key2: Val2   │ ═════════▶ │  Block 2     │     │
    │    │ Key3: Val3   │            │  Multi-page  │     │
    │    │    ...       │            │  Block 3     │     │
    │    └──────────────┘            │     ...      │     │
    │                                └──────────────┘     │
    │                                                     │
    │    Characteristics:              Characteristics:    │
    │    - Completely memory-resident   - Disk sequential   │
    │    - Fast read/write support      - Append-write opt  │
    │    - Capacity limited             - Large capacity    │
    │                                                     │
    └─────────────────────────────────────────────────────┘

### 2.2 Rolling Merge Mechanism Detailed Explanation

Rolling Merge is the core mechanism of LSM-Tree, responsible for migrating data from memory component to disk component.

**Rolling Merge Process Diagram**:

    Step 1: Read C1 Multi-page Block       Step 2: Merge C0 Entries
    ┌─────────────────────┐            ┌─────────────────────┐
    │ C0: [a,b,c,d,e]     │            │ C0: [d,e]           │
    │      ↑              │            │       (Merged)      │
    │  Merge Cursor       │            │                     │
    │                     │            │ C1 Buffer:          │
    │ C1 Buffer:          │            │ [a,b,c] + [d,e]     │
    │ [Block1: x,y,z]     │ ════════▶  │ = [a,b,c,d,e]       │
    │                     │            │                     │
    └─────────────────────┘            └─────────────────────┘

    Step 3: Write New C1 Block            Step 4: Advance Cursor
    ┌─────────────────────┐            ┌─────────────────────┐
    │ C0: [d,e,f,g]       │            │ C0: [f,g,h,i,j]     │
    │       (Next Batch)  │            │          ↑          │
    │                     │            │      New Cursor     │
    │ New C1 Block:       │ ════════▶  │                     │
    │ [a,b,c,d,e]         │            │ C1 Buffer:          │
    │ (Write to new       │            │ [Block2: m,n,o]     │
    │  disk location)     │            │                     │
    └─────────────────────┘            └─────────────────────┘

**Workflow**:

1. **Initialization Phase**
   - Determine the range of multi-page blocks in C1 to be merged (usually contiguous disk blocks)
   - Read these blocks into memory buffer

2. **Merge Phase**
   - Read a continuous segment of entries from C0 (called merge cursor)
   - Sort and merge C0 entries with existing data in C1 blocks by key
   - Handle updates (overwrite old values) and deletes (generate Tombstone)

3. **Write Phase**
   - Write merged data to new location in C1
   - Use append-write instead of overwrite, ensuring crash safety
   - Update index to point to new block

4. **Advance Phase**
   - Move merge cursor to next segment of C0
   - Loop execution until all C0 data is migrated

**Key Characteristics**:
- **Gradualness**: Not a one-time full merge, but performed in batches, controlling single I/O overhead
- **Concurrency Safety**: Through "Filling Block" and "Emptying Block" design, supports concurrent read/write
- **Crash Recovery**: Using WAL and checkpoints, can resume from interruption after failure

**Difference from LevelDB Compaction**:
- Rolling Merge: Continuous, fixed-rhythm merge
- LevelDB Compaction: On-demand triggered, batch-processing background task

### 2.3 Multi-Component Architecture

When the memory cost of two-component (C0+C1) architecture is too high, the paper proposes extending to multi-component architecture.

**Architecture Form**:

              LSM-Tree Multi-Component Architecture
    ┌────────────────────────────────────────┐
    │                                        │
    │   C0 (Memory)                          │
    │   ┌────────────────┐                   │
    │   │ Key range:     │ ← New writes      │
    │   │ [latest keys]  │                   │
    │   └───────┬────────┘                   │
    │           │ Rolling Merge              │
    │           ▼                            │
    │   C1 (Disk)                            │
    │   ┌────────────────┐  Size: 10× C0    │
    │   │ Key range:     │ ← Older data      │
    │   │ [older keys]   │                   │
    │   └───────┬────────┘                   │
    │           │ Rolling Merge              │
    │           ▼                            │
    │   C2 (Disk)                            │
    │   ┌────────────────┐  Size: 10× C1    │
    │   │ Key range:     │ ← Oldest data     │
    │   │ [oldest keys]  │                   │
    │   └───────┬────────┘                   │
    │           │                            │
    │           ▼                            │
    │   C3, C4, ... (More Disk Levels)       │
    │                                        │
    │   Each level capacity increases        │
    │   (usually 10 times)                   │
    │   Colder data resides in deeper levels │
    │                                        │
    └────────────────────────────────────────┘

**Component Size Design**:
- Optimal size ratio: r = Si/Si-1 = (SK/S0)^(1/K)
- Si: Size of i-th component
- S0: Smallest component (usually C0)
- SK: Largest component
- K: Number of components

**Practical Experience**:
- Usually using 3 components (C0, C1, C2) can satisfy most scenarios
- Benefits diminish beyond 3 components, but management complexity increases significantly
- C0 is completely memory-resident, C1 and C2 are disk-resident

**Merge Strategy**:
- C0→C1: Most frequent merge, keeping C0 size controllable
- C1→C2: Less frequent, triggered when C1 reaches certain threshold
- Asynchronous execution: Merges at each level can proceed in parallel

This multi-component design reduces memory costs significantly while maintaining write performance. The multi-level Compaction strategy used in actual systems (like LevelDB, RocksDB) is the engineering implementation of this idea.

---

### 2.4 Operation Semantics

#### Delete Operation

LSM-Tree deletion is **logical deletion** rather than physical deletion:

**Tombstone Mechanism Diagram**:

    Step 1: Insert Tombstone in C0
    ┌─────────────────────────────────────────┐
    │  C0 (Memory)                            │
    │  ┌──────────────────────────────────┐   │
    │  │ key=X: [Tombstone]  ← New write  │   │
    │  │ key=A: value1                    │   │
    │  │ key=B: value2                    │   │
    │  └──────────────────────────────────┘   │
    │                                         │
    │  C1 (Disk)                              │
    │  ┌──────────────────────────────────┐   │
    │  │ key=X: old_value  ← To be cleaned│   │
    │  │ key=C: value3                    │   │
    │  └──────────────────────────────────┘   │
    └─────────────────────────────────────────┘

    Step 2: Rolling Merge Propagation
    ┌─────────────────────────────────────────┐
    │  C0 (Memory)                            │
    │  ┌──────────────────────────────────┐   │
    │  │ key=A: value1                    │   │
    │  │ key=B: value2                    │   │
    │  └──────────────────────────────────┘   │
    │           │                             │
    │           ▼ Rolling Merge               │
    │                                         │
    │  C1 (Disk)                              │
    │  ┌──────────────────────────────────┐   │
    │  │ key=X: [Tombstone]  ← Propagated │   │
    │  │ key=X: old_value    ← Marked for │   │
    │  │                     cleaning     │   │
    │  │ key=C: value3                    │   │
    │  └──────────────────────────────────┘   │
    └─────────────────────────────────────────┘

    Step 3: Annihilation During Merge
    ┌─────────────────────────────────────────┐
    │  C1 (New Block Written)                 │
    │  ┌──────────────────────────────────┐   │
    │  │ key=A: value1                    │   │
    │  │ key=B: value2                    │   │
    │  │ key=C: value3                    │   │
    │  │ (key=X cleaned, no record)       │   │
    │  └──────────────────────────────────┘   │
    └─────────────────────────────────────────┘

**Mechanism Explanation**:

1. **Tombstone Generation**
   - Insert special "delete marker" entry (Tombstone) in C0
   - Marker contains deleted key and deletion timestamp
   - Original value position no longer matters, only need to mark key as deleted

2. **Delete Propagation**
   - Tombstone propagates from C0 to C1, C2... along with Rolling Merge
   - During merge, Tombstone "annihilates" when meeting corresponding actual entry
   - Eventually completely cleaned, releasing space

3. **Query Processing**
   - When querying, scan components from new to old in order
   - When encountering Tombstone, immediately stop search, return key does not exist
   - If actual entry is encountered first, return that value (indicating version written before deletion)

**Advantage**: Delete operations only require memory writes, no disk random access, extremely high performance.

#### Predicate Delete

Supports batch deletion based on conditions (such as "delete data older than 20 days"):
- Check each entry during Rolling Merge process
- Entries meeting conditions are directly discarded, not written to new blocks
- No need for separate scan and marking, utilize existing merge process to complete cleanup

**Application Scenarios**: Time-series data expiration, log cleanup, privacy data deletion, etc.

### 2.5 Concurrency and Recovery

#### Concurrency Control Mechanism

**Component-Level Locking**:

                 Component-Level Read-Write Lock Mechanism
    ┌────────────────────────────────────────┐
    │                                        │
    │   Read Operations (Multiple Concurrent) │
    │   ┌─────┐ ┌─────┐ ┌─────┐             │
    │   │ R1  │ │ R2  │ │ R3  │             │
    │   └──┬──┘ └──┬──┘ └──┬──┘             │
    │      └───────┼───────┘                │
    │              ▼                         │
    │   C0: Read Lock (Shared) ────────┐     │
    │   ┌──────────────────────────────┴─┐   │
    │   │         C0 Memory Component    │   │
    │   └────────────────────────────────┘   │
    │                                        │
    │   Write Operation (Exclusive)          │
    │   ┌─────┐                             │
    │   │  W  │ ──▶ C0: Write Lock (Exclusive)│
    │   └─────┘                             │
    │                                        │
    │   Rolling Merge (Requires Two-Level Lock)│
    │   ┌─────┐                             │
    │   │ RM  │ ──▶ Holds C0+C1 Write Locks  │
    │   └─────┘                             │
    │                                        │
    └────────────────────────────────────────┘

**Cursor Crossing Handling**:

                 Filling Block and Emptying Block Design
    ┌────────────────────────────────────────┐
    │                                        │
    │   Rolling Merge Cursor Position        │
    │   C0: [a,b,c,d,e,f,g,h]                │
    │            ↑                           │
    │         Cursor (scanned c)             │
    │                                        │
    │   Concurrent write key=c (new data)    │
    │   ┌────────────────┐                   │
    │   │ Filling Block  │ ◀── Temp new write│
    │   │ key=c: new_val │                   │
    │   └────────────────┘                   │
    │                                        │
    │   C1 Block to be merged                │
    │   ┌────────────────┐                   │
    │   │ Emptying Block │ ◀── Original data │
    │   │ [x,y,z,c_old]  │    (Locked)       │
    │   └────────────────┘                   │
    │                                        │
    │   Merge Result                         │
    │   ┌────────────────┐                   │
    │   │ [x,y,z,c_new]  │ ◀── Filling block │
    │   └────────────────┘    merged in      │
    │                                        │
    └────────────────────────────────────────┘

- Rolling Merge uses cursor to traverse C0 and C1
- Concurrent writes may insert at positions already scanned by cursor
- Solution: "Filling Block" and "Emptying Block" design
  - Lock C1's pending block before merge (Emptying Block)
  - Concurrent writes temporarily stored in special area (Filling Block)
  - After merge completes, Filling Block data is merged into result

#### Recovery Mechanism

**Checkpoint and WAL Mechanism Diagram**:

                 Checkpoint and WAL Collaborative Work
    ┌────────────────────────────────────────┐
    │                                        │
    │   Time ─────────────────────────────▶  │
    │                                        │
    │   ┌──────────┐    ┌──────────┐        │
    │   │ Write 1  │    │ Write 2  │        │
    │   │ (WAL 1)  │    │ (WAL 2)  │        │
    │   └────┬─────┘    └────┬─────┘        │
    │        │               │              │
    │   ┌────▼───────────────▼─────┐        │
    │   │      WAL Log File        │        │
    │   │ [W1][W2][W3][W4][W5]...  │        │
    │   └──────────────────────────┘        │
    │        ↑                              │
    │   ┌────┴────┐    ┌──────────┐        │
    │   │Checkpoint│◀───│ Write 3  │        │
    │   │  (t=N)   │    │ (WAL 3)  │        │
    │   └────┬────┘    └──────────┘        │
    │        │                              │
    │   ┌────▼──────────────┐               │
    │   │ Checkpoint File   │               │
    │   │ C0 State Snapshot │               │
    │   │ C1 Boundary Key   │               │
    │   └───────────────────┘               │
    │                                        │
    │   Recovery After Crash:                │
    │   1. Load checkpoint (t=N state)       │
    │   2. Replay WAL (W3, W4, W5...)        │
    │   3. Restore to latest state           │
    │                                        │
    └────────────────────────────────────────┘

**Checkpoint**:
- Periodically flush all or part of C0 content to disk
- Record current state of each component (size, boundary key, etc.)
- Recover from checkpoint after crash, reducing WAL replay volume

**WAL (Write-Ahead Log)**:
- Each write operation is first recorded to sequential log
- Log records contain key, value, operation type, timestamp
- After crash, scan WAL to replay un-persisted operations

**Recovery Process**:
1. Load most recent checkpoint, restore C0 and C1 state
2. Scan WAL, replay all operations after checkpoint
3. Verify consistency of each component (checksum, size, etc.)
4. Recovery complete, system available


---

## 3. LevelDB Engineering Implementation (2011)


### 3.1 Architecture Overview

LevelDB adopts the classic LSM-Tree architecture, divided into memory components and disk components.

**LevelDB Overall Architecture Diagram**:

                    LevelDB Architecture
    ┌─────────────────────────────────────────────────────────────┐
    │                                                              │
    │  Write Path:                                                 │
    │  ┌──────────┐    ┌──────────┐    ┌──────────────────────┐   │
    │  │ Put(key) │───▶│   WAL    │───▶│      MemTable        │   │
    │  └──────────┘    │  (log)   │    │   (SkipList)         │   │
    │                  └──────────┘    └──────────┬───────────┘   │
    │                                             │                │
    │  Flush (Background):                      ▼                │
    │                              ┌──────────────────────────┐   │
    │                              │   Immutable MemTable     │   │
    │                              └──────────┬───────────────┘   │
    │                                         │                    │
    │                                         ▼                    │
    │  SSTable Files:                                             │
    │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
    │  │Level 0  │  │Level 1  │  │Level 2  │  │Level 3  │        │
    │  │~4MB     │  │~10MB    │  │~100MB   │  │~1GB     │        │
    │  │(Overlapping)│ │(Non-overlap)│ │(Non-overlap)│ │(Non-overlap)│    │
    │  └─────────┘  └─────────┘  └─────────┘  └─────────┘        │
    │         ▲                                               │
    │         │ Major Compaction (Background Merge)            │
    │         └───────────────────────────────────────────────┘
    │                                                              │
    │  MANIFEST File: (Version Change Log)                        │
    │  ┌──────────────────────────────────────────────────────┐   │
    │  │  Records all SSTable file metadata for crash recovery │   │
    │  └──────────────────────────────────────────────────────┘   │
    │                                                              │
    └─────────────────────────────────────────────────────────────┘

**Level Size Configuration**:

| Level | Target Size | File Size | Characteristics |
|-------|-------------|-----------|-----------------|
| **Level 0** | 4 MB | ~2 MB | Max 4 files, keys may overlap between files |
| **Level 1** | 10 MB | ~2 MB | Keys do not overlap between files |
| **Level 2** | 100 MB | ~2 MB | Size is 10× L1 |
| **Level 3** | 1 GB | ~2 MB | And so on... |
| **Level 4** | 10 GB | ~2 MB | |
| **Level 5** | 100 GB | ~2 MB | |
| **Level 6** | 1 TB | ~2 MB | |

**Important Threshold Parameters**:
- **kL0_SlowdownWritesTrigger = 8**: Write slowdown when L0 file count reaches 8
- **kL0_StopWritesTrigger = 12**: Write stop when L0 file count reaches 12
- **kTargetFileSize = 2 MB**: SSTable target file size

**Write Path**:
1. User calls `Put(key, value)`
2. First write sequentially to WAL (Write-Ahead Log) to ensure durability
3. Then insert into memory MemTable (SkipList implementation)
4. Return write success (delayed flush)

**MemTable Flush (Minor Compaction)**:
- When MemTable reaches threshold (default 4MB), convert to Immutable MemTable
- Background thread writes Immutable MemTable to disk as Level 0 SSTable
- After write completes, release Immutable MemTable, reset WAL

**Background Merge (Major Compaction)**:
- Level 0 SSTables may have overlapping key ranges
- Triggered when Level 0 file count exceeds threshold, or lower level size exceeds limit
- Merge Level N SSTable with overlapping files in Level N+1
- Generate new sorted SSTables into lower level after merge

**Read Path**:
1. First search in MemTable
2. Then search in Immutable MemTable
3. Scan SSTables at each level from new to old
4. Use Bloom Filter for quick exclusion at each level
5. Locate specific Data Block through index
6. Binary search target key within Data Block

### 3.2 Core Data Structures

#### MemTable: SkipList

LevelDB chooses SkipList over B-Tree as MemTable implementation:

**SkipList Structure Diagram**:

                    SkipList Multi-Level Index Structure
    ┌────────────────────────────────────────────────────────────┐
    │                                                             │
    │  Level 3 (Highest): head ──────────────────────▶ [70]      │
    │                      │                                      │
    │  Level 2:           head ─────▶ [30] ─────────▶ [70]      │
    │                      │          │               │          │
    │  Level 1:           head ─────▶ [30] ──▶ [50] ─▶ [70]      │
    │                      │          │          │      │        │
    │  Level 0 (Bottom):  head ──▶ [10]─▶ [30]─▶ [50]─▶ [70]─▶ [90] │
    │                                data   data   data   data   │
    │                                                             │
    │  Search [50]: Start from Level 3, descend level by level    │
    │  - L3: head ──▶ 70 (>50), descend to L2                     │
    │  - L2: head ──▶ 30 (<50), forward ──▶ 70 (>50), descend to L1│
    │  - L1: 30 ──▶ 50 (Hit!)                                    │
    │                                                             │
    │  Time Complexity: O(log n), avg levels ≈ log₁/ₚ(n)         │
    │                                                             │
    └────────────────────────────────────────────────────────────┘

**SkipList Core Characteristics**:

- **Simple Implementation**: ~400 lines of code, no complex balancing operations
- **Concurrency Friendly**: Supports lock-free reads, implemented via atomic operations
- **Memory Efficient**: Uses Arena allocator for batch memory allocation, reduces fragmentation
- **Range Query**: Ordered structure, supports efficient range scans

**Node Height Generation**:
- Each node's height is randomly generated with probability p = 0.25
- Probability of height k: p^(k-1) * (1-p)
- Expected height: 1/(1-p) = 1.33 (average ~1.33 pointers per node)

**Time Complexity**:
- Lookup/Insert/Delete: O(log n)
- Space Complexity: O(n), average 1/(1-p) pointers per node

**Comparison with B-Tree**:

| Characteristic | B-Tree | SkipList | LevelDB Benefit |
|----------------|--------|----------|-----------------|
| Implementation Code | ~2000+ lines | **~400 lines** | 80% maintenance cost reduction |
| Concurrent Read | Requires lock | **Lock-free** | 2-3× read performance improvement |
| Memory Allocation | Frequent alloc/free | **Arena batch allocation** | Reduced memory fragmentation |
| Implementation Complexity | High (requires balancing) | **Low (probabilistic balancing)** | Lower bug rate |

#### SSTable File Format Detailed Explanation

SSTable (Sorted String Table) is LevelDB's core disk file format, designed to **efficiently store ordered key-value pairs** and **support fast queries**.

##### Overall Structure

SSTable files are divided into four regions from top to bottom:

**Data Region (Data Blocks)**:
- Stores actual key-value pair records
- Default each Data Block is 4KB (before compression)
- Records within block are ordered by key
- Uses prefix compression (shared prefixes) to reduce space

**Metadata Region (Meta Blocks)**:
- Filter Block: Stores Bloom Filter data, accelerates queries for non-existent keys
- Meta Index Block: Index pointing to Filter Block

**Index Region (Index Block)**:
- Each Data Block corresponds to one index entry
- Index entry key: Maximum key of Data Block
- Index entry value: Offset and size of Data Block

**Footer**:
- Fixed 48 bytes
- Contains location information of Meta Index Block and Index Block
- Magic Number for file format verification

##### Data Block Internal Structure

Data Block is the smallest unit storing actual key-value pairs in SSTable, default size is **4KB** (after compression).

**Structure Composition**:
1. **Key-Value Record Sequence**: Actual stored data
2. **Restart Point Array**: Used to accelerate in-block lookups

**Prefix Compression Mechanism**:
- Records within block are sorted by key, adjacent keys usually share common prefixes
- Each record only stores the difference from previous key
- Set a Restart Point every 16 records, storing complete key at that point
- During lookup, decode from nearest Restart Point to reduce computation

**Record Format**:
- Shared Length: Length of prefix shared with previous key
- Non-shared Length: Length of non-shared portion of this key
- Value Length: Value length
- Key Delta: Non-shared key bytes
- Value: Actual value

**Lookup Process**:
1. Binary search in Restart Point array to determine target record range
2. Decode sequentially from starting Restart Point of that range
3. Compare keys until found or out of range

##### Record Encoding Details

LevelDB uses **varint** (variable-length integer) encoding to reduce storage space for small values:


##### Filter Block Structure

Filter Block stores SSTable's Bloom Filter data, used to quickly exclude Data Blocks not containing target key.

**Filter Block Layout**:

    ┌─────────────────────────────────────────────────────────────┐
    │                     Filter Block Structure                   │
    ├─────────────────────────────────────────────────────────────┤
    │                                                              │
    │  ┌───────────────────────────────────────────────────────┐  │
    │  │ Filter Data 1 (corresponds to Data Block 1)            │  │
    │  │ [Bloom Filter bits, ~2KB]                              │  │
    │  │ One Filter per 2KB Data Block                          │  │
    │  └───────────────────────────────────────────────────────┘  │
    │  ┌───────────────────────────────────────────────────────┐  │
    │  │ Filter Data 2 (corresponds to Data Block 2)            │  │
    │  │ [Bloom Filter bits]                                    │  │
    │  └───────────────────────────────────────────────────────┘  │
    │                         ...                                  │
    │  ┌───────────────────────────────────────────────────────┐  │
    │  │ Filter Metadata (offset array)                         │  │
    │  │ [offset_0: 4 bytes] ← Filter Data 0 offset             │  │
    │  │ [offset_1: 4 bytes] ← Filter Data 1 offset             │  │
    │  │ ...                                                    │  │
    │  │ [base_lg: 1 byte]   ← log2(block size), default 11     │  │
    │  │                       (2KB)                            │  │
    │  └───────────────────────────────────────────────────────┘  │
    │                                                              │
    └─────────────────────────────────────────────────────────────┘

**Bloom Filter Parameters**:
- **bits_per_key**: Default 10 bits
- **k (number of hash functions)**: Calculated from bits_per_key, k ≈ 0.693 * bits_per_key ≈ 7
- **False Positive Rate**: ~1% (when bits_per_key = 10)

**False Positive Rate Calculation**:
```
P(false positive) ≈ (1 - e^(-k*n/m))^k

Where:
- n = number of keys
- m = total number of bits
- k = number of hash functions
```

| bits_per_key | False Positive Rate | Memory Overhead (per million keys) |
|--------------|---------------------|-----------------------------------|
| 5 | 5.0% | 0.625 MB |
| 8 | 1.0% | 1.0 MB |
| 10 | 0.8% | 1.25 MB |
| 15 | 0.05% | 1.875 MB |

##### Index Block Structure

Index Block stores index information for each Data Block, used to quickly locate Data Blocks.

**Index Block Layout**:

    ┌─────────────────────────────────────────────────────────────┐
    │                     Index Block Structure                    │
    ├─────────────────────────────────────────────────────────────┤
    │                                                              │
    │  ┌───────────────────────────────────────────────────────┐  │
    │  │ Index Entry 1 (corresponds to Data Block 1)            │  │
    │  │ ┌─────────────────────────────────────────────────┐   │  │
    │  │ │ Key: Maximum key of Data Block 1                 │   │  │
    │  │ │ Value: [offset: varint32][size: varint32]        │   │  │
    │  │ └─────────────────────────────────────────────────┘   │  │
    │  └───────────────────────────────────────────────────────┘  │
    │  ┌───────────────────────────────────────────────────────┐  │
    │  │ Index Entry 2 (corresponds to Data Block 2)            │  │
    │  │ ┌─────────────────────────────────────────────────┐   │  │
    │  │ │ Key: Maximum key of Data Block 2                 │   │  │
    │  │ │ Value: [offset: varint32][size: varint32]        │   │  │
    │  │ └─────────────────────────────────────────────────┘   │  │
    │  └───────────────────────────────────────────────────────┘  │
    │                         ...                                  │
    │                                                              │
    │  Lookup Process:                                             │
    │  1. Binary search for target key in Index Block              │
    │  2. Find first Entry where max_key >= target_key             │
    │  3. Read Data Block according to offset and size in Entry    │
    │                                                              │
    └─────────────────────────────────────────────────────────────┘

##### Footer Detailed Format (48 bytes)

Footer is the tail of SSTable file, fixed 48 bytes, containing pointers to critical metadata blocks.

**Footer Layout**:

    ┌─────────────────────────────────────────────────────────────┐
    │                     Footer (48 bytes)                        │
    ├─────────────────────────────────────────────────────────────┤
    │                                                              │
    │  Offset 0-7:    Meta Index Block Handle (8 bytes)            │
    │                 ├─ offset: varint32 (max 5 bytes)            │
    │                 └─ size: varint32 (max 5 bytes)              │
    │                                                              │
    │  Offset 8-15:   Index Block Handle (8 bytes)                 │
    │                 ├─ offset: varint32                          │
    │                 └─ size: varint32                            │
    │                                                              │
    │  Offset 16-39:  Padding (24 bytes)                           │
    │                 Reserved space for future extension,         │
    │                 currently filled with 0                      │
    │                                                              │
    │  Offset 40-47:  Magic Number (8 bytes)                       │
    │                 Fixed value: 0xdb4775248b80fb57              │
    │                 (little-endian)                              │
    │                 Used to verify file format integrity         │
    │                                                              │
    └─────────────────────────────────────────────────────────────┘

**Why 48 bytes?**
- Historical reasons: Compatible with early SSTable format
- Design consideration: Sufficient to store necessary metadata + future extension space
- Alignment requirement: 8-byte alignment, improves read efficiency


##### Internal Key Format Detailed Explanation

LevelDB adds metadata when storing keys to support multi-versioning, delete markers, and transactions. Internal Key is the core mechanism for LSM-Tree to implement MVCC (Multi-Version Concurrency Control).

**Internal Key Structure** (Total length = user_key_length + 8 bytes):


###### Sequence Number


**Sequence Number Characteristics:**
- **Globally Incrementing**: Each write operation (Put/Delete/Merge) increments sequence number by 1
- **Monotonicity Guarantee**: Protected by DBImpl mutex lock, ensuring thread safety
- **Snapshot Isolation**: Record current sequence number when reading, only read data ≤ that sequence number
- **Descending Order**: Same User Key ordered by sequence number descending, ensuring latest version returned first

###### Type (Type Byte)


**Type Descriptions:**

| Type | Value | Purpose | Cleanup Timing |
|------|-------|---------|----------------|
| **kTypeDeletion** | 0x00 | Mark key as deleted | Can be cleaned after Compaction when no snapshot reference |
| **kTypeValue** | 0x01 | Normal key-value pair | Can be cleaned when overwritten by new version and no snapshot reference |
| **kTypeMerge** | 0x02 | Merge operation (incremental update) | Generate new value after merging with base value |
| **kTypeSingleDelete** | 0x07 | Single delete optimization | Delete immediately upon encounter, no history retained (must ensure no same key before) |

###### Internal Key Encoding Details


**Encoding Layout (Little-Endian):**

###### Sorting Rules Detailed Explanation

Internal Key comparator implementation:


**Sorting Example:**


###### Version Control and Garbage Collection

**Version Visibility Rules:**


**Garbage Collection Timing:**
- **Compaction**: Main cleanup mechanism, checks snapshot references
- **Snapshot Release**: When oldest snapshot advances, old versions can be cleaned
- **Periodic Cleanup**: Background thread checks expired data

**Internal Key Layout Diagram**:

    ┌─────────────────────────────────────────────────────────────┐
    │                 Internal Key Structure                       │
    ├─────────────────────────────────────────────────────────────┤
    │                                                              │
    │  [User Key (variable)] [Sequence Number (7 bytes)] [Type (1 byte)]│
    │                                                              │
    │  Example: key="hello", seq=100, type=kTypeValue              │
    │  ┌──────────┬──────────────────┬──────────┐                  │
    │  │  "hello" │  0x000000000064  │  0x01    │                  │
    │  │  (5B)    │     (7B)         │  (1B)    │                  │
    │  └──────────┴──────────────────┴──────────┘                  │
    │                                                              │
    │  Sorting Rule: User Key ascending → Sequence Number descending│
    │  Effect: Latest version of same key appears first            │
    │                                                              │
    └─────────────────────────────────────────────────────────────┘

###### Lookup Key Format

Temporary Key format used during reads:


**Lookup Key Characteristics:**
- Contains snapshot sequence number
- Uses `kValueTypeForSeek = 0xffffffff` to ensure finding all types
- Used to locate starting position in MemTable/SSTable

##### SSTable Lookup Process


##### SSTable Build Process


##### SSTable File Example


#### SSTable Advantages Summary

| Characteristic | Description | Effect |
|----------------|-------------|--------|
| **Prefix Compression** | Adjacent keys share prefixes | Save 30-50% space |
| **Block-based** | Fixed-size Data Blocks | Efficient caching and compression |
| **Bloom Filter** | Quickly exclude files not containing key | Reduce 90%+ disk reads |
| **Index Structure** | Two-level index (Index + Data Block) | O(log n) query |
| **Immutability** | SSTable unmodifiable once written | Simplify concurrency and caching |

Internal Key format: [User Key | Sequence Number (7B) | Type (1B)]
Sorting rule: User Key ascending → Sequence Number descending


### 3.3 Write Process

LevelDB's write process adopts the classic WAL + MemTable pattern, ensuring data durability and high performance.

**Write Flow Diagram**:

                    LevelDB Write Flow
    ┌─────────────────────────────────────────────────────────────┐
    │                                                              │
    │  User Call: Put(key, value)                                 │
    │       │                                                      │
    │       ▼                                                      │
    │  ┌───────────────────────────────────────────────────────┐  │
    │  │  1. Join Writer Queue (Serialized writer queue)        │  │
    │  │     - Multiple write requests merged into WriteBatch   │  │
    │  │     - Batch write improves throughput                  │  │
    │  └───────────────────────────────────────────────────────┘  │
    │       │                                                      │
    │       ▼                                                      │
    │  ┌───────────────────────────────────────────────────────┐  │
    │  │  2. Write-Ahead Logging                               │  │
    │  │     - Write WAL first (sequential write)               │  │
    │  │     - Optional sync: force flush for durability        │  │
    │  └───────────────────────────────────────────────────────┘  │
    │       │                                                      │
    │       ▼                                                      │
    │  ┌───────────────────────────────────────────────────────┐  │
    │  │  3. Write to MemTable                                 │  │
    │  │     - Insert into SkipList                             │  │
    │  │     - Use custom comparator for sorting                │  │
    │  └───────────────────────────────────────────────────────┘  │
    │       │                                                      │
    │       ▼                                                      │
    │  ┌───────────────────────────────────────────────────────┐  │
    │  │  4. MemTable Full Transition                          │  │
    │  │     - MemTable → Immutable MemTable                    │  │
    │  │     - Create new mem_ and log file                     │  │
    │  │     - Background Flush to L0 SSTable                   │  │
    │  └───────────────────────────────────────────────────────┘  │
    │                                                              │
    └─────────────────────────────────────────────────────────────┘

**Write Batching Detailed Explanation**:

Write batching is LevelDB's key optimization for improving write throughput.

**Working Mechanism**:
1. **Write Queue**: All write requests enter FIFO queue
2. **Batch Processing**: Writer at queue head responsible for merging subsequent write requests
3. **Batch WAL**: Merged batch data written to WAL once
4. **Batch MemTable**: Batch data inserted into MemTable once
5. **Notification Mechanism**: Notify all waiting writers upon completion

**Effect Quantification**:

| Thread Count | Throughput without Batching | Throughput with Batching | Improvement |
|--------------|----------------------------|--------------------------|-------------|
| 1 thread | 100 Kops/s | 100 Kops/s | 1× |
| 4 threads | 150 Kops/s | 380 Kops/s | 2.5× |
| 8 threads | 180 Kops/s | 720 Kops/s | 4× |
| 16 threads | 200 Kops/s | 950 Kops/s | 4.75× |

**Why Improvement?**
- Reduce WAL write count (multiple random writes → one sequential write)
- Reduce lock contention (serialized processing)
- Improve CPU cache hit rate (batch processing)

### 3.4 Compaction Mechanism Detailed Explanation

Compaction is the core mechanism of LSM-Tree, responsible for merging data from upper levels to lower levels while maintaining ordering. LevelDB has two types of Compaction:
- **Minor Compaction**: MemTable → SSTable (Level 0)
- **Major Compaction**: Level N → Level N+1

#### 3.4.1 Minor Compaction Detailed Process

Minor Compaction converts Immutable MemTable in memory to Level 0 SSTable on disk.

**Trigger Conditions**:
- MemTable size reaches threshold (default 4MB)
- Background thread continuously checks, triggers when condition met

**Detailed Steps**:

**Step 1: Create Immutable MemTable**
- Mark current MemTable as Immutable (cannot be modified)
- Create new MemTable to receive new writes
- Switch WAL to new log file

**Step 2: Smart Output Level Selection**
- Default output to Level 0
- But LevelDB checks if can "skip level" to higher level
- If Immutable MemTable's key range doesn't overlap with Level 0 and higher levels, can directly place in L1/L2
- Reduce subsequent L0→L1 Compaction overhead

**Step 3: Write SSTable**
- Iterate through all key-values in Immutable MemTable
- Write sequentially to new SSTable file
- Build Data Blocks, Index Block, Filter Block
- Finally write Footer

**Step 4: Update Metadata**
- Add new SSTable info to VersionSet
- Record to MANIFEST file to ensure durability
- Delete old WAL file
- Release Immutable MemTable memory

**Special Optimization - Level Skipping**:
LevelDB decides Immutable MemTable's output level by checking key range overlap:
- If no overlap with L0, try placing in L1
- If no overlap with L1 either, and small overlap with L2, can place in L2
- And so on, up to L4
- This smart selection significantly reduces Compaction overhead for small range updates

#### 3.4.2 Major Compaction Detailed Process

Major Compaction merges data from upper levels to lower levels, maintaining ordering and level constraints.

**Trigger Conditions**:
- Level 0 file count exceeds threshold (default 4)
- Total size of a level exceeds target (L1: 10MB, L2: 100MB, L3: 1GB...)
- Manual trigger (compact_range API)

**Compaction Selection Algorithm**:

**L0→L1 Compaction Special Characteristics**:
- Level 0 SSTables may overlap, must all participate in merge
- Find all L1 files overlapping with L0 files to be merged
- Multi-way merge all overlapping files, generate new L1 SSTables

**L1+ Compaction Standard Process**:
- Select "most crowded" SSTable in that level (file size/layer size ratio largest)
- Only select this one file, find overlapping files in L+1 level
- Merge selected files, generate new L+1 SSTables
- Delete old files

**Compaction Execution Process**:
1. **Input Collection**: Determine all SSTables to be merged
2. **Multi-way Merge**: Use min-heap to merge multiple ordered inputs
3. **Output Generation**: Write new SSTables sequentially, maintain target file size (default 2MB)
4. **Metadata Update**: Atomically update VersionSet, record to MANIFEST
5. **Old File Cleanup**: Delete merged old SSTables (actually delayed deletion, ensure no reference before cleanup)

**Why L0→L1 is Most Expensive**:
- L0 file overlap causes need to read more files
- L1 size limit (10MB) causes frequent triggering
- Is the bottleneck of entire LSM-Tree, subsequent optimizations (like Universal Compaction) mostly target this

#### 3.4.3 Garbage Collection in Compaction

Compaction is not just merging data, but also responsible for cleaning expired data.

**Garbage Collection Judgment Logic**:

During Compaction, judge whether to discard each key:

1. **Hidden by New Version**:
   - If same user key has newer version (higher sequence number)
   - And no snapshot references old version
   - Then discard old version

2. **Delete Marker Cleanup**:
   - If it's a delete marker (kTypeDeletion)
   - And no snapshot references this marker
   - And no data for this key in higher levels
   - Then can discard this delete marker

**Version Visibility Rules**:
- Each snapshot records sequence number at creation time
- When reading, can only see data ≤ snapshot sequence number
- During Compaction, check oldest snapshot, versions older than it can be cleaned

### 3.5 Version Management (VersionSet)

LevelDB uses Copy-on-Write style version control, supporting snapshot isolation and concurrent read/write.

**VersionSet Structure**:

                    Version Management
    ┌─────────────────────────────────────────────────────────────┐
    │                                                              │
    │  VersionSet                                                  │
    │  ┌───────────────────────────────────────────────────────┐  │
    │  │  current_  ───────────────────────▶ Version 3 (Current)│  │
    │  │                                      ├── FileMetaData[]│  │
    │  │                                      ├── level_files_  │  │
    │  │                                      └── refs: 1       │  │
    │  └───────────────────────────────────────────────────────┘  │
    │                  │                                           │
    │                  ▼                                           │
    │  ┌───────────────────────────────────────────────────────┐  │
    │  │  Version 2 (Old Version)                               │  │
    │  │  ├── FileMetaData[]                                    │  │
    │  │  ├── refs: 0 (reference count 0, pending deletion)     │  │
    │  │  └── next: Version 3                                   │  │
    │  └───────────────────────────────────────────────────────┘  │
    │                  │                                           │
    │                  ▼                                           │
    │  ┌───────────────────────────────────────────────────────┐  │
    │  │  Version 1 (Even Older Version)                        │  │
    │  │  └── ...                                               │  │
    │  └───────────────────────────────────────────────────────┘  │
    │                                                              │
    │  ┌───────────────────────────────────────────────────────┐  │
    │  │  MANIFEST File                                         │  │
    │  │  - Records all version change logs                     │  │
    │  │  - Used during crash recovery                          │  │
    │  │  - VersionEdit serialization format                    │  │
    │  └───────────────────────────────────────────────────────┘  │
    │                                                              │
    └─────────────────────────────────────────────────────────────┘

**Version Structure**:
- Each level contains a FileMetaData array, recording all SSTable files in that level
- FileMetaData contains: file number, size, minimum key, maximum key
- Reference count (refs): Cannot delete when snapshot reference exists

**MANIFEST File**:
- Records all version changes (VersionEdit)
- Including: new files, deleted files, comparator changes, etc.
- Recover version state by replaying MANIFEST after crash

**Snapshot**:
- Record current sequence number at creation
- When reading, only read data ≤ snapshot sequence number
- Support multi-version concurrency control (MVCC)
- After release, old versions can be cleaned by Compaction

#### 3.5.1 Version Management Process

1. **Normal Read/Write**:
   - Acquire current version reference (refs++)
   - Read/write based on SSTable collection of this version
   - Release reference when complete (refs--)

2. **Compaction Complete**:
   - Create new version, containing new SSTable collection
   - Atomically switch current_ to point to new version
   - Decrement old version reference count

3. **Old Version Cleanup**:
   - When version's refs == 0, can be recycled
   - SSTable files unique to this version can be deleted

#### 3.4.4 Compaction Strategy Comparison

| Strategy | Principle | Write Amplification | Read Amplification | Space Amplification | Applicable Scenario |
|----------|-----------|---------------------|--------------------|---------------------|---------------------|
| **Leveled** (LevelDB Default) | Each level fully sorted, adjacent level size ratio 10:1 | High (10-30×) | Low (O(1)) | Low | Read-heavy |
| **Tiered** (RocksDB Universal) | Multiple sorted runs per level, delayed merge | Low (2-5×) | High (O(T)) | High | Write-heavy |
| **Leveled-N** | Hybrid strategy, L0-LN uses Tiered, LN+ uses Leveled | Medium | Medium | Medium | Mixed workload |
| **FIFO** | Only keep recent N files | Very Low | High | Very High | Time-series data, cache |

**Leveled vs Tiered Compaction Diagram:**


#### 3.4.5 Compaction Tuning Parameters


**Tuning Suggestions:**

### 3.6 Read Optimization

LevelDB designs multi-layer optimization strategy for LSM-Tree's need to check multiple levels during reads.

**Read Amplification Sources**:
- Worst case: Need to check MemTable + Immutable + L0-L6, total 8 levels
- Each level may need to open one SSTable, read Bloom Filter, Index Block, Data Block
- For non-existent key, need to check all levels to confirm

**Optimization Strategies**:

**1. MemTable Priority**
- Latest data always in MemTable, fastest lookup
- SkipList O(log n) lookup complexity

**2. SSTable Cache (Table Cache)**
- Cache opened SSTable file descriptors and metadata
- Avoid frequent open/close file system call overhead

**3. Block Cache**
- LRU cache recently read Data Blocks
- Hot data directly hits memory, no disk read needed
- Default 8MB, configurable

**4. Bloom Filter Filtering**
- Each SSTable has corresponding Bloom Filter
- Check Filter first during query, quickly exclude files not containing target key
- For non-existent key, reduce 90%+ disk reads

**5. Level Skipping Optimization**
- Utilize SSTable file ordering, maintain key range index per level
- If target key < minimum key of a level or > maximum key, skip that level directly

**6. Prefetch Optimization**
- During range query, asynchronously prefetch next Block while reading current Block
- Utilize disk sequential read high bandwidth

**Read Performance Comparison (With/Without Optimization)**:

| Scenario | Without Optimization | With Optimization | Improvement |
|----------|---------------------|-------------------|-------------|
| Point Query (Exists) | 3-8 ms | 0.1-0.5 ms | 6-30× |
| Point Query (Not Exists) | 10-20 ms | 0.5-1 ms | 10-40× |
| Range Query | Linear Scan | Binary+Sequential Read | 10-100× |


---

## 4. Comparison Between LevelDB and Original LSM-Tree Paper


> This chapter deeply analyzes the key evolution from LSM-Tree theory (1996) to LevelDB engineering implementation (2011), revealing how industrial practice optimizes theoretical models.

### 4.1 Core Differences Overview

The LSM-Tree paper proposed a theoretical framework and cost model, but transforming it into an industrial-grade system requires numerous engineering decisions. LevelDB, while maintaining core ideas, made several key improvements:


### 4.2 Detailed Comparison Analysis

#### 4.2.1 Architecture Design Comparison

| Aspect | LSM-Tree Paper (1996) | LevelDB (2011) | Improvement Significance |
|--------|----------------------|----------------|--------------------------|
| **C0 Implementation** | B-Tree variant or (2-3) tree | **SkipList** | 5× code simplification (400 lines vs 2000+ lines), supports lock-free reads |
| **Level Design** | Conceptual C0, C1, C2...Ck | **Fixed 7 levels L0-L6** | Engineering simplification, clear parameters, easy to tune |
| **L0 Special Handling** | None (all levels same structure) | **Allows file overlapping** | Reduces write amplification by 30%+, lowers L0→L1 merge pressure |
| **Disk Format** | Generic multi-page blocks | **SSTable format** | Prefix compression, Bloom Filter, index optimization |
| **MemTable Structure** | B-Tree-like | **SkipList** | Higher memory efficiency, better range query performance |

#### 4.2.2 Core Data Structure Comparison

**MemTable: B-Tree vs SkipList**


**SkipList Advantage Quantification:**

| Characteristic | B-Tree | SkipList | LevelDB Benefit |
|----------------|--------|----------|-----------------|
| Implementation Code | ~2000+ lines | **~400 lines** | 80% maintenance cost reduction |
| Concurrent Read | Requires lock | **Lock-free** | 2-3× read performance improvement |
| Memory Allocation | Frequent alloc/free | **Arena batch allocation** | Reduced fragmentation, faster allocation |
| Implementation Complexity | High (requires balancing) | **Low (probabilistic balancing)** | Lower bug rate, easier to optimize |

#### 4.2.3 Compaction Strategy Comparison

**LSM-Tree Paper: Continuous Rolling Merge**

**LevelDB: On-demand Trigger + Background Thread**

#### 4.2.4 Read Optimization Comparison

**LSM-Tree Paper: No Specialized Optimization**
- Sequential search of each level
- Need to read complete data blocks for binary search

**LevelDB: Multi-layer Optimization**

| Optimization Technology | Paper (1996) | LevelDB (2011) | Read Amplification Reduction |
|-------------------------|--------------|----------------|------------------------------|
| **Bloom Filter** | ❌ Not mentioned | ✅ Per-file + per-block filters | 90%+ |
| **Block Cache** | ❌ Not mentioned | ✅ LRU cache Data Block | 50-70% |
| **Index Block** | ❌ Not mentioned | ✅ Fast Data Block location | Avoid full file scan |
| **Table Cache** | ❌ Not mentioned | ✅ Cache SSTable metadata | Reduce file open count |
| **Prefix Compression** | ❌ Not mentioned | ✅ Key shared prefix compression | Save 30-50% storage space |

**Bloom Filter Effect Quantification:**

#### 4.2.5 Concurrency and Consistency Comparison

| Characteristic | LSM-Tree Paper (1996) | LevelDB (2011) | Improvement |
|----------------|----------------------|----------------|-------------|
| **Concurrent Read** | Node-level locking | **Version control + lock-free read** | 2-5× read performance improvement |
| **Concurrent Write** | Not discussed in detail | **Write Batching** | 10×+ throughput improvement |
| **Snapshot Isolation** | Mentioned but not implemented | **Full MVCC support** | Supports transactions and backup |
| **Recovery Mechanism** | Checkpoint + WAL | **MANIFEST + version management** | 3× recovery speed improvement |

**Write Batching Detailed Explanation:**

#### 4.2.6 Level Design Detailed Comparison

**LSM-Tree Paper: Variable Multi-Component**

**LevelDB: Fixed 7 Levels + Level 0 Special Handling**

### 4.3 Key Improvements Summary

#### Engineering Simplification
| Improvement Point | Paper Complexity | LevelDB Implementation | Simplification Effect |
|-------------------|------------------|------------------------|----------------------|
| MemTable | B-Tree variant (complex balancing) | SkipList (probabilistic balancing) | Code volume -80% |
| Level Management | Dynamic multi-component | Fixed 7 levels | Configuration simplification |
| Compaction | Continuous Rolling Merge | Threshold trigger | Resource controllable |
| File Format | Generic multi-page blocks | SSTable | Rich functionality |

#### Performance Improvement
| Metric | Paper Model | LevelDB | Improvement |
|--------|-------------|---------|-------------|
| Write Throughput | Theoretical model | ~10 MB/s (HDD) / ~100 MB/s (SSD) | Engineering achievable |
| Read Performance | Unoptimized | Optimized, read amplification reduced 70% | Engineering optimization |
| Concurrency | Not discussed | Supports multi-thread read/write | Modern requirements |
| Resource Control | Continuous occupation | Controllable background tasks | Production-friendly |

### 4.4 Design Philosophy Differences

The LSM-Tree paper and LevelDB demonstrate different design orientations from theory to engineering.

**Theory-oriented vs Engineering-oriented**:

| Dimension | LSM-Tree Paper (1996) | LevelDB (2011) |
|-----------|----------------------|----------------|
| **Goal** | Prove LSM superiority in cost model | Build industrial-grade high-performance embedded storage |
| **Focus** | Mathematical optimization, asymptotic complexity | Actual performance, engineering simplicity, maintainability |
| **Architecture** | Generic multi-component model | Fixed 7 levels + special L0 |
| **Implementation** | Conceptual description | Complete runnable code (~20KB) |
| **Optimization** | Theoretical cost minimization | Comprehensive balance of read/write amplification, space amplification |

**Core Differences Analysis**:

**1. MemTable Choice: B-Tree vs SkipList**
- Paper: Suggests using B-Tree or (2-3) tree, ensuring deterministic performance
- LevelDB: Uses SkipList, code volume reduced by 80%, simpler implementation
- Engineering trade-off: Probabilistic balance for implementation simplicity, actual performance difference is small

**2. Compaction Mode: Continuous vs On-demand**
- Paper: Rolling Merge is a continuously running background task
- LevelDB: Compaction triggered on-demand, with clear trigger conditions
- Engineering trade-off: Controllable resource usage, avoiding continuous I/O occupation

**3. Level Design: Dynamic vs Fixed**
- Paper: Component count and size can be dynamically adjusted based on workload
- LevelDB: Fixed 7 levels, each level size increases 10×
- Engineering trade-off: Simplified configuration and management, easier to understand and tune

**4. Read Optimization: None vs Multi-layer**
- Paper: Does not specifically discuss read optimization
- LevelDB: Multi-layer optimizations including Bloom Filter, Block Cache, indexes, etc.
- Engineering trade-off: 2011 SSD proliferation, random read performance improved, requiring targeted read optimization

**Key Insights**:
1. **Theory to engineering requires trade-offs**: LevelDB simplified the theoretical model but gained better engineering characteristics
2. **Hardware changes drive design**: 2011 SSD proliferation made optimizations like Bloom Filter, parallel reads important
3. **Simplicity first**: SkipList replacing B-Tree is a key factor in engineering success
4. **Controllability matters**: On-demand Compaction is more suitable for production than continuous Rolling Merge

### 4.5 Impact on Subsequent Systems

LevelDB's design decisions influenced the entire LSM-Tree ecosystem:


---

## 5. WiscKey Key-Value Separation Optimization (2016)


> **Paper**: WiscKey: Separating Keys from Values in SSD-Conscious Storage  
> **Authors**: Lanyue Lu, Thanumalayan Sankaranarayana Pillai, Andrea C. Arpaci-Dusseau, Remzi H. Arpaci-Dusseau  
> **Institution**: University of Wisconsin, Madison  
> **Published**: FAST 2016  
> **Core Idea**: Key-Value Separation - Separating values from LSM-tree to significantly reduce I/O amplification

### 5.1 Research Background and Motivation

#### 5.1.1 Core Problems of LSM-Tree

LSM-Tree (such as LevelDB, RocksDB), while avoiding random writes, suffers from severe **I/O amplification** problems:

**Write Amplification: 12× - 50×**
- Cause: Data is repeatedly read and written during Compaction process
- Example: Writing 1GB of data may require 12-50GB of actual disk writes

**Read Amplification: 3× - 14×**
- Cause: Lookup needs to traverse multiple levels of SSTables
- Example: Reading 1KB of data may require reading 3-14KB of actual data

**Space Amplification**
- Actual occupation exceeds original data due to invalid data not being cleaned in time

#### 5.1.2 Essential Differences Between SSD and HDD

**HDD (Hard Disk Drive)**:
- Random I/O is 100×+ slower than sequential I/O
- LSM-Tree's trade-off is reasonable: Use sequential writes in exchange for query performance

**SSD (Solid State Drive)**:
- Random read performance is close to sequential read (50% single-thread, can match with multi-thread)
- Random writes still have overhead (erase-write cycle)
- High I/O amplification wastes bandwidth and shortens SSD lifespan
- Internal parallelism: Multiple channels/chips can process random reads in parallel

**Conclusion**: LSM-Tree's design assumptions are no longer fully applicable on SSDs

#### 5.1.3 Key Observations

1. **Compaction only cares about Key order**: Value sorting is not essential for range queries
2. **Keys are usually much smaller than Values**: In modern workloads, keys are ~16B, values are 100B-4KB+
3. **SSD parallel random read ≈ sequential read**: This makes range queries feasible after key-value separation

### 5.2 Key-Value Separation Architecture

#### 5.2.1 Overall Architecture

                    WiscKey Architecture Diagram
    ┌─────────────────────────────────────────────────────────────┐
    │                                                              │
    │  ┌─────────────────┐         ┌───────────────────────────┐  │
    │  │   LSM-tree      │         │         vLog              │  │
    │  │  (Stores only   │         │    (Value Log append-only)│  │
    │  │   Keys)         │         │                           │  │
    │  │                 │         │                           │  │
    │  │  Key1 → addr1   │────────▶│  addr1: Value1            │  │
    │  │  Key2 → addr2   │         │  addr2: Value2            │  │
    │  │  Key3 → addr3   │         │  addr3: Value3            │  │
    │  │  ...            │         │  ...                      │  │
    │  │                 │         │                           │  │
    │  │  L0-L6 (SSTable)│         │  Sequential append write  │  │
    │  │  Size significantly│       │  Background Garbage       │  │
    │  │  reduced        │         │  Collection               │  │
    │  └─────────────────┘         └───────────────────────────┘  │
    │                                                              │
    │  Core Advantages:                                            │
    │  1. LSM-tree greatly shrinks → Compaction cost significantly │
    │     reduced                                                   │
    │  2. Value sequential append → Write performance approaches   │
    │     device bandwidth                                          │
    │  3. Read operation: Query LSM-tree for address → Random read │
    │     vLog                                                      │
    │                                                              │
    └─────────────────────────────────────────────────────────────┘

#### 5.2.2 Detailed Data Layout

**Record format in LSM-tree**:
```
Key | Value-Address (vLog offset)
```

**Record format in vLog**:
```
Key | Value | Value-Size (used for GC verification)
```

**vLog Management**:
- **Head pointer** (in memory): New Value append position
- **Tail pointer** (persistent): Valid data starting position
- Both Tail and Head pointers are stored in LSM-tree: `<"tail", tail-vLog-offset>`, `<"head", head-vLog-offset>`

#### 5.2.3 Design Goals

| Goal | Description |
|------|-------------|
| **Low Write Amplification** | Reduce unnecessary writes, extend SSD lifespan |
| **Low Read Amplification** | Improve query throughput, enhance cache efficiency |
| **SSD Optimization** | Match SSD's parallel random read characteristics |
| **Complete Functionality** | Support LSM-tree features like range queries, snapshots |
| **Realistic Key-Value Sizes** | Optimize for small key (16B) + variable-length value scenarios |

### 5.3 Key Challenges and Solutions

#### 5.3.1 Challenge 1: Range Query Performance

**Problem**: After key-value separation, range queries require random reads to vLog, performance may degrade

**Solution**: Utilize SSD parallel random reads + prefetching

**Prefetching Mechanism**:

1. Sequentially read a batch of keys from LSM-tree (e.g., 1000)
2. Extract corresponding value addresses
3. Put addresses into work queue
4. 32 background threads parallel random read vLog
5. Utilize SSD internal parallelism to achieve bandwidth close to sequential reads

**Performance Results**:
- Small value (64B): 12× slower than LevelDB (device random read limitation)
- Large value (4KB+): 8.4× faster than LevelDB
- Sequentially written data: Performance close to LevelDB (data in vLog is already sorted)

**Further Optimization**: For small value scenarios, log reorganization (sorting) can be performed

#### 5.3.2 Challenge 2: Garbage Collection

**Problem**: After delete/update, invalid values are generated in vLog, space needs to be reclaimed

**Solution**: Online lightweight garbage collector

**Trigger Conditions**:
- Configured to run periodically
- Or space usage reaches threshold
- Supports offline mode for maintenance

**Collection Process**:

1. Sequentially read chunk from Tail (e.g., 16MB)
2. For each Key-Value pair:
   - Look up this Key in LSM-tree
   - Check if address in LSM-tree matches current vLog position
   - If match: Valid data, append write to Head
   - If not match: Invalid data, skip
3. Update Tail pointer
4. Use fallocate(FALLOC_FL_PUNCH_HOLE) to release space

**Consistency Guarantee**:
- First fsync() appended data in vLog
- Then synchronously update Tail pointer in LSM-tree
- After crash: Everything before Tail is persisted, after may be lost

**Performance Overhead (Random Write Workload)**:
| Invalid Data Ratio | Throughput Degradation |
|--------------------|------------------------|
| 100% | < 10% |
| 50% | ~25% |
| 25% | ~35% |

Can be balanced by adjusting GC frequency and space reservation

#### 5.3.3 Challenge 3: Crash Consistency

**Problem**: After key-value separation, how to ensure data consistency during crash recovery?

**Solution**: Utilize append atomicity of modern file systems

**File System Guarantees (ext4, btrfs, xfs)**:
- Append operation atomicity: After crash, file only contains complete appended prefix
- Will not occur: Partial writes, out-of-order writes, garbage data

**WiscKey Write Order**:
1. Value first appended to vLog
2. fsync() vLog to ensure persistence
3. Key + Address written to LSM-tree (persistence guaranteed by its WAL)

**Crash Recovery Process**:
- Read Head pointer from LSM-tree
- Scan vLog from Head to end of file
- Rebuild Key → Address mapping
- Duplicate data handled by LSM-tree deduplication mechanism

**Exception Query Handling**:
- Key in LSM-tree, but Value address out of range: Delete Key
- Key in LSM-tree, but Key in Value doesn't match: Delete Key
- Value exists but Key lost: Will be recycled by subsequent GC
- Double verification during query: Address range + Key match

**Recovery Time**:
- LevelDB: 0.7 seconds (1KB value)
- WiscKey: 2.6 seconds (need to scan vLog)
- Can be optimized by more frequent Head pointer persistence

#### 5.3.4 Additional Optimization: Remove LSM-tree WAL

**Observation**:
- LSM-tree's WAL is used to recover MemTable data
- WiscKey's vLog already contains complete Key-Value data
- Can recover by scanning vLog, no additional WAL needed

**Optimization**:
- Completely remove LSM-tree's log file, reduce one write

**Recovery Process**:
- Get most recent Head pointer from LSM-tree
- Scan vLog from Head to end
- Rebuild LSM-tree index

**Effect**:
- Particularly effective for small writes, reduce ~50% write volume

### 5.4 Performance Evaluation Results

#### 5.4.1 Experimental Setup

| Configuration | Parameters |
|---------------|------------|
| **Device** | 500GB Samsung 840 EVO SSD |
| **Database Size** | 100 GB |
| **Key Size** | 16 Bytes |
| **Value Size** | 64B - 256KB |
| **Comparison Systems** | LevelDB 1.18, RocksDB |

#### 5.4.2 Micro Benchmark - Load Performance

**Sequential Load** - Throughput (MB/s):

| Value Size | 64B | 256B | 1KB | 4KB | 16KB | 64KB | 256KB |
|-----------|-----|------|-----|-----|------|------|-------|
| **LevelDB** | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| **WiscKey** | 40 | 80 | 150 | 350 | 450 | 480 | 500 |
| **Improvement** | 2.5× | 5× | 15× | 46× | 45× | 48× | 50× |

**Random Load** - Throughput (MB/s):

| Value Size | 64B | 256B | 1KB | 4KB | 16KB | 64KB | 256KB |
|-----------|-----|------|-----|-----|------|------|-------|
| **LevelDB** | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| **WiscKey** | 40 | 80 | 150 | 350 | 450 | 480 | 500 |
| **Improvement** | 2.5× | 5× | 15× | **111×** | **104×** | 85× | 46× |

**Write Amplification Comparison**:

| Value Size | 64B | 256B | 1KB | 4KB | 16KB | 64KB | 256KB |
|-----------|-----|------|-----|-----|------|------|-------|
| **LevelDB** | 14 | 12 | 12 | 12 | 12 | 12 | 12 |
| **WiscKey** | 4.5 | 2.5 | 1.2 | **1.05** | **1.01** | ~1 | ~1 |

#### 5.4.3 Micro Benchmark - Query Performance

**Random Lookup** - Throughput (KOps/s):

| Value Size | 64B | 256B | 1KB | 4KB | 16KB | 64KB | 256KB |
|-----------|-----|------|-----|-----|------|------|-------|
| **LevelDB** | 25 | 10 | 4 | 3 | 2.5 | 2.5 | 2.5 |
| **WiscKey** | 40 | 48 | **48** | **42** | 40 | 36 | 30 |
| **Improvement** | 1.6× | 4.8× | **12×** | **14×** | 16× | 14× | 12× |

**Range Query** - Throughput (MB/s):

**Randomly written database (vLog unordered)**:

| Value Size | 64B | 256B | 1KB | 4KB | 16KB | 64KB | 256KB |
|-----------|-----|------|-----|-----|------|------|-------|
| **LevelDB** | 4 | 12 | 45 | 120 | 180 | 220 | 230 |
| **WiscKey** | 0.3 | 1.2 | 8 | 60 | 150 | 210 | 230 |
| **Relative Performance** | 0.12× | 0.1× | 0.18× | 0.5× | 0.83× | 0.95× | 1.0× |

**Sequentially written database (vLog ordered)**:

| Value Size | 64B | 256B | 1KB | 4KB | 16KB | 64KB | 256KB |
|-----------|-----|------|-----|-----|------|------|-------|
| **LevelDB** | 4 | 12 | 45 | 120 | 180 | 220 | 230 |
| **WiscKey** | 3 | 10 | 40 | 120 | 180 | 220 | 230 |
| **Relative Performance** | 0.75× | 0.83× | 0.89× | 1.0× | 1.0× | 1.0× | 1.0× |

#### 5.4.4 Garbage Collection Overhead

| Invalid Data Ratio | 25% | 50% | 75% | 100% |
|--------------------|-----|-----|-----|------|
| **Throughput Degradation** | ~35% | ~25% | ~15% | **<10%** |

Note: Even with 100% invalid data, GC overhead is small because it's mainly sequential I/O

#### 5.4.5 Space Amplification

Actual size of 100GB randomly written database:

| System | Actual Size | Space Amplification |
|--------|-------------|---------------------|
| **LevelDB** | ~120 GB | 1.2× |
| **WiscKey (Before GC)** | ~115 GB | 1.15× |
| **WiscKey (After GC)** | ~102 GB | **1.02×** |

#### 5.4.6 YCSB Macro Benchmark

**Value = 1KB**:

| Workload | Description | LevelDB | RocksDB | WiscKey-GC | WiscKey |
|----------|-------------|---------|---------|------------|---------|
| **LOAD** | Load 100GB | 1.0× | 1.2× | **45×** | **50×** |
| **A** | 50% read, 50% update | 1.0× | 1.1× | **4.6×** | **4.6×** |
| **B** | 95% read, 5% update | 1.0× | 1.3× | **4.0×** | **5.4×** |
| **C** | 100% read | 1.0× | 1.1× | **3.6×** | **5.4×** |
| **D** | 95% read, 5% insert | 1.0× | 1.7× | **3.4×** | **3.6×** |
| **E** | 95% range query | 1.0× | 0.8× | 0.7× | 0.8× |
| **F** | 50% read, 50% RMW | 1.0× | 0.7× | **3.5×** | **3.4×** |

**Value = 16KB**:

| Workload | LevelDB | RocksDB | WiscKey-GC | WiscKey |
|----------|---------|---------|------------|---------|
| **LOAD** | 1.0× | 1.3× | **100×** | **104×** |
| **A-F** | 1.0× | 1.1-2.5× | **2×-7.5×** | **2.3×-7.5×** |

**Conclusion**: WiscKey outperforms LevelDB and RocksDB in almost all YCSB workloads

#### 5.4.7 Recovery Time

Database recovery time after crash (1KB value):

| System | Recovery Time |
|--------|---------------|
| **LevelDB** | 0.7 seconds |
| **WiscKey** | 2.6 seconds |

Analysis:
- WiscKey needs to scan vLog to rebuild index
- Can be optimized by more frequent Head pointer persistence
- Recovery time increases 3.7×, but still within acceptable range

### 5.5 Detailed Comparison with LevelDB

| Characteristic | LevelDB | WiscKey | Description |
|----------------|---------|---------|-------------|
| **Core Idea** | LSM-Tree | **Key-Value Separated LSM-Tree** | WiscKey retains LSM advantages, removes main overhead |
| **LSM-tree Content** | Key + Value | **Only Key + Value Address** | LSM size significantly reduced |
| **Value Storage** | SSTable | **Independent vLog (Append Log)** | Sequential write, no Compaction |
| **Write Amplification** | 12× - 50× | **~1×** | Most significant improvement |
| **Read Amplification** | 3× - 14× | **~1× + 1 random read** | Still advantageous in small value scenarios |
| **Range Query** | Sequential read | **Parallel random read** | Better performance in large value scenarios |
| **Garbage Collection** | Compaction | **vLog GC (Lightweight)** | Only sequential I/O |
| **Crash Recovery** | LSM-tree log | **vLog Scan** | Can remove LSM WAL |
| **Space Amplification** | Higher | **Lower (close to 1 after GC)** | More SSD space efficient |
| **CPU Usage** | Lower | Slightly higher | Range queries require multi-thread processing |
| **Applicable Scenarios** | General | **SSD + Medium/Large Value** | Best effect when value > 1KB |

**Architecture Comparison Diagram**:

    ┌─────────────────────────────────────────────────────────────────┐
    │                      LevelDB vs WiscKey                          │
    ├─────────────────────────────────────────────────────────────────┤
    │                                                                  │
    │  LevelDB:                                                        │
    │  ┌─────────┐    ┌─────────┐    ┌─────────────────────────────┐  │
    │  │ MemTable│───▶│ Immutable│───▶│ L0-L6 SSTable (Key+Value)  │  │
    │  │(SkipList│    │ MemTable│    │ Compaction needs to sort    │  │
    │  └─────────┘    └─────────┘    │ Key+Value                   │  │
    │       ▲                          └─────────────────────────────┘  │
    │       │ WAL                                                      │
    │  ┌────┴────┐                                                     │
    │  │   Log   │                                                     │
    │  └─────────┘                                                     │
    │                                                                  │
    │  WiscKey:                                                        │
    │  ┌─────────┐    ┌─────────┐    ┌─────────────────────────┐      │
    │  │ MemTable│───▶│ Immutable│───▶│ L0-L6 SSTable (Key only)│      │
    │  │(SkipList│    │ MemTable│    │ Compaction only sorts Key│      │
    │  └─────────┘    └─────────┘    └─────────────────────────┘      │
    │       │                              │                          │
    │       │                              │ (Address reference)       │
    │       ▼                              ▼                          │
    │  ┌─────────────────────────────────────────┐                    │
    │  │              vLog (Value Log)           │                    │
    │  │  ┌─────────────────────────────────┐   │                    │
    │  │  │ Tail │ ... Valid Values ... │ Head│   │                    │
    │  │  └─────────────────────────────────┘   │                    │
    │  │         (Sequential append, background GC)                  │
    │  └─────────────────────────────────────────┘                    │
    │                                                                  │
    └─────────────────────────────────────────────────────────────────┘

### 5.6 Design Insights and Subsequent Impact

#### 5.6.1 Core Design Insights

1. **Workload Characteristics Determine Storage Design**
   - Observation: In modern workloads, keys are small (16B), values vary greatly (100B-4KB+)
   - Insight: Compaction only cares about Key order
   - Conclusion: Key-value separation can significantly reduce Compaction overhead

2. **Hardware Characteristics Influence Architecture Choice**
   - SSD random read close to sequential read → Key-value separation feasible
   - SSD high internal parallelism → Multi-thread random reads effective
   - SSD lifespan limited by write volume → Reducing write amplification necessary

3. **Trade-off Re-evaluation**
   - Traditional LSM: Sequential write vs Query performance
   - WiscKey: Lower write amplification + Utilize SSD parallelism

4. **File System Characteristics Can Be Leveraged**
   - Append operation atomicity simplifies crash consistency design

#### 5.6.2 Applicable Scenarios

**WiscKey Best Suited For**:
- SSD storage devices
- Value size >= 1KB
- Write-intensive workloads
- Scenarios requiring range queries but not too large query ranges

**WiscKey Not Suited For**:
- HDD storage (poor random read performance)
- Very small values (below 64B)
- Workloads dominated by large-range sequential scans

#### 5.6.3 Subsequent Related Work

WiscKey influenced multiple subsequent storage systems:

    WiscKey (2016)
        │
        ├──→ Titan (PingCAP, 2018)
        │       └── TiKV's key-value separation engine
        │       └── Architecture similar to WiscKey
        │
        ├──→ TerarkDB (ByteDance, 2019)
        │       └── Combines WiscKey with other compression optimizations
        │
        ├──→ BlobDB (Facebook RocksDB)
        │       └── RocksDB's built-in key-value separation implementation
        │       └── Large values automatically separated to Blob files
        │
        ├──→ HashKV (SOSP 2018)
        │       └── Further optimizes GC efficiency, reduces data migration
        │
        └──→ RocksDB's Integrated BlobDB (2021+)
                └── Integrates WiscKey ideas into main branch

#### 5.6.4 Paper Contribution Summary

| Contribution Type | Specific Content |
|-------------------|------------------|
| **Problem Identification** | Points out LSM-Tree's high I/O amplification problem is particularly severe on SSDs |
| **Core Innovation** | Proposes key-value separation architecture, significantly reduces Compaction overhead |
| **Challenge Solution** | Solves three major challenges: range query, garbage collection, crash consistency |
| **Experimental Proof** | Performance significantly better than LevelDB/RocksDB under various workloads |
| **Open Source Implementation** | Implemented based on LevelDB 1.18, reproducible and extensible |

#### 5.6.5 Significance for LSM-Tree Development

WiscKey represents an important milestone in LSM-Tree optimization shifting from **generality** to **hardware-awareness**:

- **Before**: LSM-Tree design mainly considered HDD characteristics
- **WiscKey**: Redesigned for SSD characteristics, proving order-of-magnitude performance improvements achievable
- **After**: More work focuses on hardware characteristics (such as ZNS SSD, Persistent Memory)

---

## 6. PebblesDB FLSM Optimization (2017)


> **Paper**: PebblesDB: Building Key-Value Stores using Fragmented Log-Structured Merge Trees  
> **Authors**: Pandian Raju, Rohan Kadekodi, Vijay Chidambaram, Ittai Abraham  
> **Institution**: University of Texas at Austin, VMware Research  
> **Published**: SOSP 2017 (ACM Symposium on Operating Systems Principles)  
> **Core Contribution**: Proposed FLSM (Fragmented Log-Structured Merge Trees) data structure, combining Skip List and LSM-Tree, significantly reducing write amplification

### 6.1 Research Background and Motivation

#### 6.1.1 LSM-Tree Write Amplification Problem

LSM-Tree (such as LevelDB, RocksDB), while avoiding random writes, has a severe **write amplification** problem:

**Root Cause**: LSM requires non-overlapping key ranges for sstables at each level
- New data writes need to be merged and sorted with existing data
- Same data is repeatedly read and written during Compaction process
- Write amplification can reach 12× - 50×

**Traditional LSM Compaction Example**:
```
L0: {1,100}  →  L1: {1,50}  →  L2: {1,25}
                  {100,200}       {25,100}
                                  {100,400}
```
Data {1,100} is rewritten 3 times!

**Consequences**:
- SSD lifespan shortened
- Storage costs increased
- Write throughput reduced (RocksDB write throughput is only 10% of read)

#### 6.1.2 Limitations of Traditional Solutions

| Solution | Method | Limitation |
|----------|--------|------------|
| **No sstable merging** | Directly add new sstable to level | Read performance drops sharply, need to check multiple sstables |
| **Specialized hardware** | Utilize SSD FTL features (NVMKV) | Depends on specific hardware, poor generality |
| **Sacrifice read performance** | LSM-trie, Universal Compaction | Does not support range queries or poor read performance |
| **Key-value separation** | WiscKey | Range query performance drops, requires GC |

#### 6.1.3 Core Insight

> **Root cause of LSM write amplification: Requirement for non-overlapping (disjoint) key ranges for sstables at each level**

If overlapping sstables are allowed at the same level, data rewriting during Compaction can be avoided.

**Challenge**: How to maintain efficient query performance while allowing overlap?

**Solution**: Use **Guards** (inspired by Skip List)

### 6.2 FLSM Core Design

#### 6.2.1 Guards Mechanism

                    FLSM Guards Mechanism
    ┌─────────────────────────────────────────────────────────────┐
    │                                                              │
    │  Guard: Key randomly selected from inserted keys, used to    │
    │         partition key space                                  │
    │                                                              │
    │  Key Properties:                                             │
    │  ├── Guards have non-overlapping key ranges (disjoint)       │
    │  ├── Each Guard can have multiple attached sstables          │
    │  │   (overlap allowed)                                        │
    │  ├── Higher-level Guards contain all Guards from lower       │
    │  │   levels (similar to Skip List)                           │
    │  └── Lowest level has most Guards                            │
    │                                                              │
    │  Guard Selection Probability:                                │
    │  ├── Level 1: Lowest probability (fewest Guards)             │
    │  ├── Level i+1: Probability > Level i (more Guards)          │
    │  └── Example: If probability is 1/10, select 1 Guard per     │
    │      10 keys                                                 │
    │                                                              │
    │  Example Layout:                                             │
    │                                                              │
    │  Level 3:  [Guard:5]────[Guard:100]────[Guard:375]────[Guard:1023] │
    │              │            │              │               │   │
    │  Level 2:    [G:5]────────[G:100]────────[G:375]              │
    │              │            │              │                   │
    │  Level 1:    [G:5]────────[G:100]                             │
    │              │                                                │
    │  Level 0:    (No Guards, new sstables attached directly)      │
    │                                                              │
    │  sstables under each Guard (overlap allowed):                │
    │  Guard:5 may have: {1,20}, {2,35}, {5,40} (all contain key 5)│
    │                                                              │
    └─────────────────────────────────────────────────────────────┘

#### 6.2.2 FLSM vs LSM Architecture Comparison

                    LSM vs FLSM Architecture Comparison
    ┌─────────────────────────────────────────────────────────────────┐
    │                                                                  │
    │  Traditional LSM:                                                │
    │  ┌─────────────────────────────────────────────────────────┐   │
    │  │ Level 1: [1..100] [200..300] [400..500]                │   │
    │  │          ↑ Each key in only one sstable                 │   │
    │  │ Level 0: [1..50] [60..80] [200..250]                   │   │
    │  │          ↑ Can overlap                                  │   │
    │  └─────────────────────────────────────────────────────────┘   │
    │                                                                  │
    │  FLSM:                                                          │
    │  ┌─────────────────────────────────────────────────────────┐   │
    │  │ Level 1: Guard:50 ────── Guard:200 ────── Guard:400   │   │
    │  │          │                  │                │          │   │
    │  │          ▼                  ▼                ▼          │   │
    │  │        [1,60]             [150,250]        [350,450]   │   │
    │  │        [20,80]            [180,300]        [380,500]   │   │
    │  │        [40,100]           [200,350]        [400,550]   │   │
    │  │        ↑ sstables under same Guard can overlap          │   │
    │  └─────────────────────────────────────────────────────────┘   │
    │                                                                  │
    │  Key Differences:                                                │
    │  ├── LSM: sstables at each level must be disjoint              │
    │  ├── FLSM: Guards are disjoint, sstables within Guard can      │
    │  │          overlap                                             │
    │  └── FLSM: Query first finds Guard, then checks all sstables   │
    │            under that Guard                                    │
    │                                                                  │
    └─────────────────────────────────────────────────────────────────┘

#### 6.2.3 FLSM Compaction Algorithm

                    FLSM Compaction Process
    ┌─────────────────────────────────────────────────────────────┐
    │                                                              │
    │  Traditional LSM Compaction:                                  │
    │  1. Read Level i sstable and overlapping sstables in         │
    │     Level i+1                                                │
    │  2. Merge and sort all key-values                            │
    │  3. Write new sstables to Level i+1                          │
    │  4. Delete old sstables                                      │
    │  → Data is rewritten!                                        │
    │                                                              │
    │  FLSM Compaction (Most Cases):                               │
    │  1. Select a Guard in Level i (when its sstables count       │
    │     exceeds threshold)                                       │
    │  2. Partition all sstables of this Guard by Guards in        │
    │     Level i+1                                                │
    │  3. Directly append (append) partitioned sstables to         │
    │     corresponding Guard in Level i+1                         │
    │  4. Delete old sstables in Level i                           │
    │  → Data is only partitioned, not rewritten!                  │
    │                                                              │
    │  Example:                                                    │
    │  Level 1 Guard:5 has sstable {1, 20, 45, 101, 245}          │
    │  Level 2 Guards: 1, 40, 200                                  │
    │  Compaction Result:                                          │
    │  ├── Guard:1 gets {1, 20}                                    │
    │  ├── Guard:40 gets {45, 101}                                 │
    │  └── Guard:200 gets {245}                                    │
    │                                                              │
    │  Note: Only at highest level (Last Level) needs rewriting    │
    │        to control fragmentation                              │
    │                                                              │
    └─────────────────────────────────────────────────────────────┘

**Two Compaction Modes**:

| Mode | Trigger Condition | Operation | Write Amplification |
|------|-------------------|-----------|---------------------|
| **Partition Compaction** | Non-highest level | Only partition, no sorting | Close to 1× |
| **Rewrite Compaction** | Highest level or too fragmented | Merge, sort, rewrite | Similar to LSM |

### 6.3 PebblesDB Implementation Optimizations

#### 6.3.1 Solving FLSM Read Performance Problem

FLSM Problem: Queries need to check all sstables under Guard, read performance decreases.

**PebblesDB Optimization Techniques**:

| Optimization Technique | Description | Effect |
|------------------------|-------------|--------|
| **SSTable-level Bloom Filter** | Each sstable has Bloom Filter | Avoid reading sstables not containing target key |
| **Parallel Seek** | Multi-thread parallel search of multiple sstables within Guard | Reduce seek latency |
| **Seek-Based Compaction** | Trigger Compaction when seek count exceeds threshold | Reduce sstable count within Guard |
| **Aggressive Compaction** | Trigger when Level i size exceeds 25% of Level i+1 | Reduce number of levels to search |

#### 6.3.2 Guard Selection Algorithm

**Hash-based Guard Selection**:

PebblesDB uses hash-based Guard selection algorithm to avoid uneven Guard distribution caused by hot keys.

**Core Idea**:
- Calculate hash value for each key
- Check if last N bits of hash value are all 1s
- Higher the level, smaller the N → Higher match probability → More Guards

**Probability Design (Example)**:
- Level 1: Last 8 bits must be 1 → Probability ~ 1/256 (fewest Guards)
- Level 2: Last 6 bits must be 1 → Probability ~ 1/64
- Level 3: Last 4 bits must be 1 → Probability ~ 1/16 (most Guards)

This design ensures higher levels have more Guards, forming a hierarchical structure similar to Skip List.

#### 6.3.3 Guard Asynchronous Insertion

Guards are not inserted synchronously, but lazily bound:

1. When new key passes hash check to become Guard, first add to "uncommitted_guards" set
2. During subsequent Compaction process, sstables are partitioned and attached to new Guard
3. This lazy insertion avoids synchronous overhead while maintaining Guard hierarchical structure

#### 6.3.4 PebblesDB Operation Flow

**Get Operation**:
1. Check MemTable
2. Search level by level from Level 0:
   - Binary search to locate Guard
   - Check all sstables under Guard (use Bloom Filter to filter)
   - Return if found

**Range Query**:
1. Determine Guards involved at each level
2. Binary search to locate starting key in relevant sstables within each Guard
3. Use multi-way merge (similar to Merge Sort) to produce ordered result
4. Use parallel read optimization

### 6.4 Performance Evaluation

#### 6.4.1 Experimental Environment

- **Hardware**: Dell Precision Tower 7810, Intel Xeon 2.8GHz, 16GB RAM
- **Storage**: 2× Intel 750 SSD (1.2TB each, RAID0)
- **System**: Ubuntu 16.04 LTS, Linux 4.4 kernel, ext4
- **Dataset**: 3× larger than memory (ensure data mainly resides on disk)

#### 6.4.2 Micro Benchmark (db_bench)

**Write Amplification Comparison** (Insert 500 million key-value, total 45GB):

| System | Total Write IO | Write Amplification |
|--------|----------------|---------------------|
| **LevelDB** | 540 GB | 12× |
| **HyperLevelDB** | 600 GB | 13.3× |
| **RocksDB** | 840 GB | 18.7× |
| **PebblesDB** | **175 GB** | **3.9×** |

**Throughput Comparison**:

Random Write:
- LevelDB: Baseline
- HyperLevelDB: 1.1×
- RocksDB: 0.5×
- **PebblesDB: 2.7× (6.7× vs RocksDB)**

Random Read:
- PebblesDB: Approximately equal to HyperLevelDB, similar or slightly better than other systems

Range Query:
- Pure seek: PebblesDB 30% slower (worst case)
- 50 next(): PebblesDB 15% slower
- 1000 next(): PebblesDB 11% slower

**Update Throughput** (50M key-value):

| Operation | PebblesDB | HyperLevelDB | LevelDB | RocksDB |
|-----------|-----------|--------------|---------|---------|
| Insert 50M | 56.18 KOps/s | 40.00 KOps/s | 22.42 KOps/s | 14.12 KOps/s |
| Update Round 1 | 47.85 KOps/s | 24.55 KOps/s | 12.29 KOps/s | 7.60 KOps/s |
| Update Round 2 | 42.55 KOps/s | 19.76 KOps/s | 11.99 KOps/s | 7.36 KOps/s |

#### 6.4.3 YCSB Macro Benchmark

Write-dominant workloads (Load A, Load E):
- PebblesDB: 1.5-2× faster than RocksDB
- PebblesDB: 1.5× faster than HyperLevelDB
- Write IO: 50% less than RocksDB

Read-dominant workloads (B, C, D):
- Workload C (100% read): PebblesDB better (caches more indexes)
- Workload B/D: Comparable to HyperLevelDB
- Workload E (95% range query): 6% slower

Workload F (RMW): Comparable to other systems

#### 6.4.4 Real Application Testing

**MongoDB (using PebblesDB as storage engine)**:
- Load A: 18% faster than WiredTiger
- A (50% write): 50% faster than WiredTiger
- Write IO: 4% less than WiredTiger
- 40% less IO than RocksDB

Note: Application layer overhead limits performance improvement magnitude

**HyperDex**:
- Average improvement: 18-105% (depends on workload)
- Write IO: 35-55% reduction
- Large value (16KB): More obvious improvement (105%)

#### 6.4.5 Resource Consumption

| Resource | PebblesDB vs Others | Description |
|----------|---------------------|-------------|
| **Memory** | Uses more | Need to store Guard metadata and more Bloom Filters |
| **CPU** | Uses more | Guard lookup and parallel search overhead |
| **Space Amplification** | Similar | Invalid data cleanup mechanism similar |

### 6.5 Theoretical Analysis

#### 6.5.1 Asymptotic Complexity (DAM Model)

**Assumptions**:
- Total data items: n
- Block size: B
- Guard probability: 1/B (Guards increase B times per level)
- Number of levels H = log_B(n)

**Write Cost**:
- Write once per level: O(H) = O(log_B(n))
- Rewrite at last level: O(B) times
- Total write cost: O((B + log_B(n))/B)

**Read Cost**:
- Binary search Guard at each level: O(log(B^H)) = O(H·log B) = O(log n)
- Check sstables within Guard: O(1) after using Bloom Filter (most cases)
- Total read cost: O(log n) memory operations + O(1) disk read

#### 6.5.2 FLSM as Generalization of LSM

When max_sstables_per_guard = 1:
- Each Guard can only have 1 sstable
- Equivalent to traditional LSM (sstables disjoint at each level)
- Performance comparable to LSM

FLSM Advantages:
- max_sstables_per_guard > 1: Lower write amplification, higher write throughput
- Tunable parameters balance read/write performance

### 6.6 Comparison with Related Work

#### 6.6.1 Comparison with WiscKey

| Characteristic | WiscKey | PebblesDB |
|----------------|---------|-----------|
| **Core Idea** | Key-value separation | Guards organize overlapping sstables |
| **Write Amplification Reduction** | Yes (significant) | Yes (significant) |
| **Range Query** | Performance drops (random read) | Slight drop (optimizable) |
| **Garbage Collection** | Requires independent GC | Not needed (handled during Compaction) |
| **MemTable** | Key only | Key+Value |
| **Applicable Scenarios** | Large Value | General |

#### 6.6.2 Comparison with Other LSM Optimizations

| System | Method | Limitation |
|--------|--------|------------|
| **bLSM** | Snowshoveling scheduling | Does not reduce write amplification, only smooths writes |
| **VT-tree** | Avoid re-sorting already sorted data | Depends on data distribution |
| **LSM-trie** | Use Trie structure | Does not support range queries |
| **TRIAD** | Hot-cold separation + delayed Compaction | Orthogonal to FLSM, can be used together |
| **PebblesDB** | FLSM + Guards | Read performance slightly drops |

### 6.7 Limitations and Applicable Scenarios

#### 6.7.1 PebblesDB Limitations

1. **Poor Sequential Write Performance**
   - LSM can directly move sstable
   - FLSM must partition, generating extra IO

2. **Range Query Overhead**
   - Pure seek operations 30% slower
   - Large number of next() can amortize overhead

3. **Memory Consumption**
   - Need to store Guard metadata
   - More Bloom Filters

4. **CPU Overhead**
   - Guard lookup
   - Parallel search coordination

#### 6.7.2 Applicable Scenarios

**Best Suited For**:
- Random write-dominated workloads
- Write throughput sensitive scenarios
- SSD storage (extend lifespan)
- Write-intensive NoSQL applications

**Not Suited For**:
- Pure sequential writes (log type)
- Large number of small range queries (no next() to amortize)
- Memory-constrained environments

### 6.8 Summary and Impact

#### 6.8.1 Core Contributions

1. **FLSM Data Structure**: First proposed Fragmented LSM, allowing overlapping sstables at each level
2. **Guards Mechanism**: Inspired by Skip List, efficiently organizes overlapping sstables
3. **PebblesDB Implementation**: Proved can simultaneously achieve low write amplification, high write throughput, acceptable read performance
4. **Practical Application**: Successfully integrated into MongoDB and HyperDex

#### 6.8.2 Design Insights

1. Traditional LSM's disjoint sstable constraint is the root cause of write amplification
2. Through Guards organizing data, can maintain query efficiency while allowing overlap
3. Write optimization and read optimization can be balanced, not necessarily zero-sum
4. Tunable parameters (max_sstables_per_guard) allow optimization for different workloads

#### 6.8.3 Key Technologies Summary

| Technology | Purpose | Effect |
|------------|---------|--------|
| Guards | Organize overlapping sstables | Allow Compaction without re-sorting |
| SSTable Bloom Filters | Accelerate reads | Avoid reading irrelevant sstables |
| Parallel Seek | Accelerate range queries | Multi-thread search of multiple sstables |
| Seek-Based Compaction | Control Guard size | Balance read/write performance |
| Hash-based Guard Selection | Avoid skew | Evenly distribute Guards |

#### 6.8.4 Subsequent Impact

PebblesDB's FLSM ideas influenced multiple subsequent systems:
- Proved LSM can have lower write amplification implementations
- Guards concept borrowed by other systems
- Inspired more innovations in Compaction algorithms
- Demonstrated feasibility of "partial sorting"

---

## 7. RocksDB and Industrial Practice


### 7.1 RocksDB Architecture Evolution

RocksDB is an industrial-grade LSM-Tree storage engine developed by Facebook based on LevelDB, with approximately 600,000 lines of C++ code and 1300+ files. Its core design goal is to provide enterprise-level high performance, scalability, and reliability while maintaining LevelDB's simplicity.

**Core Design Philosophy**:

1. **High Performance**: Multi-threaded compaction, parallel I/O, CPU cache optimization
2. **Scalability**: Column Family, tiered storage, pluggable architecture
3. **Flexibility**: Rich configuration options, multiple Compaction strategies
4. **Reliability**: Complete transaction support, backup/recovery, crash recovery

**Core Architecture Layers**:

                    RocksDB Core Architecture
    ┌─────────────────────────────────────────────────────────────┐
    │                         API Layer                            │
    │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
    │  │  Put    │ │  Get    │ │ Delete  │ │ Snapshot│           │
    │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘           │
    └───────┼───────────┼───────────┼───────────┼─────────────────┘
            │           │           │           │
    ┌───────▼───────────▼───────────▼───────────▼─────────────────┐
    │                   Write Layer (WAL + MemTable)               │
    │  ┌───────────────────────────────────────────────────────┐  │
    │  │  WriteBatch → WAL (Write-Ahead Log) → MemTable        │  │
    │  │  (SkipList / HashSkipList / VectorRep)                │  │
    │  └───────────────────────────────────────────────────────┘  │
    └─────────────────────────────────────────────────────────────┘
            │
    ┌───────▼─────────────────────────────────────────────────────┐
    │                  Flush Layer (Minor Compaction)              │
    │  MemTable ──[Flush]──> Immutable MemTable ──[Build]──> L0   │
    └─────────────────────────────────────────────────────────────┘
            │
    ┌───────▼─────────────────────────────────────────────────────┐
    │               Compaction Layer (Major Compaction)            │
    │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
    │  │  Level 0│→│  Level 1│→│  Level 2│→│  Level 6│           │
    │  │ (Overlap)│ │(Non-overlap)│ │(Non-overlap)│ │(Non-overlap)│    │
    │  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
    └─────────────────────────────────────────────────────────────┘
            │
    ┌───────▼─────────────────────────────────────────────────────┐
    │                    Storage Layer                             │
    │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
    │  │SSTable  │ │SSTable  │ │BlobFile │ │MANIFEST │           │
    │  │(Block- │ │(Filter- │ │(Large  │ │(Metadata)│           │
    │  │ based) │ │ Block)  │ │ Value) │ │         │           │
    │  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
    └─────────────────────────────────────────────────────────────┘
            │
    ┌───────▼─────────────────────────────────────────────────────┐
    │                   Cache & Memory Management                  │
    │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
    │  │ Block   │ │ Table   │ │ Row     │ │ Clock/  │           │
    │  │ Cache   │ │ Cache   │ │ Cache   │ │ LRU     │           │
    │  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
    └─────────────────────────────────────────────────────────────┘

**Key Differences from LevelDB**:

| Aspect | LevelDB | RocksDB |
|--------|---------|---------|
| **Concurrency** | Single-threaded compaction | Multi-threaded compaction |
| **Transactions** | None | Full support |
| **Backup** | None | BackupEngine |
| **Column Family** | None | Supported |
| **BlobDB** | None | Built-in |
| **Cache** | Simple LRU | HyperClockCache |
| **Compaction Strategy** | Leveled | Leveled/Universal/FIFO |

### 7.2 BlobDB: Industrial Implementation of WiscKey

RocksDB's BlobDB is an industrial-grade implementation of the WiscKey key-value separation concept, separating large values from SSTables for storage, significantly reducing write amplification.

#### 7.2.1 Architecture Design

**Key-Value Separation Principle**:

Traditional LSM:
```
SSTable: [Key1|Value1] [Key2|Value2] ...
         ↓ Values repeatedly rewritten during Compaction
```

BlobDB:
```
SSTable: [Key1|BlobRef1] [Key2|BlobRef2] ...
BlobFile: [Value1] [Value2] ... (Append-only, no Compaction)
```

**Core Components**:

| Component | Location | Function |
|-----------|----------|----------|
| **BlobFileBuilder** | `db/blob/blob_file_builder.cc` | Build Blob files |
| **BlobFileReader** | `db/blob/blob_file_reader.cc` | Read Blob files |
| **BlobIndex** | Stored in SSTable | Pointer to Blob file |
| **BlobGarbageCollector** | `db/blob/blob_garbage_collector.cc` | Garbage collection |

#### 7.2.2 Blob File Format

```
Blob File Layout
┌─────────────────────────────────────────────────────────────┐
│ Blob Records                                               │
│ ┌───────────────────────────────────────────────────────┐   │
│ │ Key (for verification) │ Value │ CRC32 │                │   │
│ └───────────────────────────────────────────────────────┘   │
│ ...                                                         │
├─────────────────────────────────────────────────────────────┤
│ Blob Index (Stored in SSTable)                              │
│ ┌───────────────────────────────────────────────────────┐   │
│ │ blob_file_number │ offset │ size │ compression_type   │   │
│ └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

#### 7.2.3 Key Configuration Parameters

| Configuration | Default Value | Description |
|---------------|---------------|-------------|
| `enable_blob_files` | false | Enable key-value separation |
| `min_blob_size` | 0 | Values smaller than this still stored in SSTable |
| `blob_file_size` | 256MB | Blob file target size |
| `enable_blob_garbage_collection` | true | Enable garbage collection |
| `blob_garbage_collection_age_cutoff` | 0.25 | GC only processes old files |
| `blob_garbage_collection_force_threshold` | 1.0 | Force GC threshold |

#### 7.2.4 Garbage Collection Mechanism

BlobDB's GC is performed automatically during Compaction:

1. **Scan**: Traverse Blob Index in SSTable
2. **Verify**: Check if each value is still valid
3. **Copy**: Append valid values to new Blob file
4. **Update**: Modify Blob Index pointer in SSTable
5. **Cleanup**: Delete old Blob files

**GC Trigger Conditions**:
- Configured to run periodically
- Invalid data ratio exceeds threshold
- Automatic check during Compaction

#### 7.2.5 Differences from WiscKey

| Characteristic | WiscKey | BlobDB |
|----------------|---------|--------|
| **Implementation** | Standalone system | RocksDB built-in |
| **GC** | Requires separate implementation | Coordinated with Compaction |
| **Configuration** | Limited | Rich configuration options |
| **Monitoring** | Basic | Comprehensive statistics |
| **Applicable Scenarios** | Large value specific | General, automatic selection |

**Applicable Scenarios**:
- Average value size > 1KB
- Write-intensive, need to reduce write amplification
- Can accept slight range query performance degradation


### 7.3 Compaction Strategy Detailed Explanation

RocksDB provides three main Compaction strategies, suitable for different workload scenarios.

#### 7.3.1 Leveled Compaction

**Source**: `db/compaction/compaction_picker_level.cc`

**Core Idea**: SSTable key ranges at each level are completely non-overlapping, similar to LevelDB.

**Trigger Conditions**:
1. L0 file count exceeds `level0_file_num_compaction_trigger` (default 4)
2. Total size of a level exceeds `max_bytes_for_level_base × (level_multiplier ^ (L-1))`
3. Manual trigger (CompactRange)

**Compaction Selection Algorithm**:
```
1. Prioritize L0 (if file count exceeds threshold)
2. Otherwise select "most crowded" level (current size / target size ratio largest)
3. Select earliest created SSTable in that level as input
4. Find all overlapping SSTables in next level
5. Check overlap with grandparent level, limit Compaction size
```

**Write Amplification**: 10-30× (depends on data distribution)
**Read Amplification**: Low (O(1), at most one SSTable per level)

**Applicable Scenarios**:
- Read-heavy (read/write > 10:1)
- Frequent range queries
- Need stable read performance

#### 7.3.2 Universal Compaction (Size-Tiered)

**Source**: `db/compaction/compaction_picker_universal.cc`

**Core Idea**: Delayed merging, each level allows multiple overlapping sorted runs, sorted by size.

**Trigger Conditions**:
1. Space amplification exceeds threshold (`max_size_amplification_percent`)
2. Number of similar-sized runs exceeds threshold
3. Total run count exceeds `level0_file_num_compaction_trigger`

**Merge Strategy**:
```
1. Space amplification merge: When total size > (100 + threshold)% of valid data
2. Size ratio merge: Merge runs of similar size
3. File count merge: When total run count is too high
```

**Write Amplification**: 2-5× (significantly lower than Leveled)
**Read Amplification**: Higher (need to check multiple runs)

**Applicable Scenarios**:
- Write-heavy (write/read > 10:1)
- Log-type workloads
- Sequential writes

#### 7.3.3 FIFO Compaction

**Source**: `db/compaction/compaction_picker_fifo.cc`

**Core Idea**: Only keep latest data, similar to cache.

**Trigger Conditions**:
- Total size exceeds `compaction_options_fifo.max_table_files_size`
- Or TTL expired

**Compaction Behavior**:
```
1. Sort by file creation time
2. Delete oldest files until size within limit
3. No merge operations performed
```

**Write Amplification**: Very low (~1×, no rewriting)
**Read Amplification**: Very high (may need to check many files)

**Applicable Scenarios**:
- Time-series data
- Cache
- TTL-dominated scenarios

#### 7.3.4 Strategy Comparison Summary

| Strategy | Write Amplification | Read Amplification | Space Amplification | Applicable Scenario | RocksDB Recommendation |
|----------|---------------------|--------------------|---------------------|---------------------|------------------------|
| **Leveled** | 10-30× | Low (O(1)) | Low | Read-heavy | Default |
| **Universal** | 2-5× | Medium-High | Medium | Write-heavy | Log-type |
| **FIFO** | ~1× | Very High | Very High | Time-series/Cache | Special scenarios |
| **BlobDB** | 2-5× | Medium | Low | Large value | General large value |

#### 7.3.5 Configuration Selection Recommendations

**Read-heavy (read/write > 10:1)**:
```cpp
options.compaction_style = kCompactionStyleLevel;
options.level0_file_num_compaction_trigger = 4;
options.level_slowdown_writes_trigger = 20;
options.level_stop_writes_trigger = 36;
```

**Write-heavy (write/read > 10:1)**:
```cpp
options.compaction_style = kCompactionStyleUniversal;
options.compaction_options_universal.max_size_amplification_percent = 200;
options.compaction_options_universal.size_ratio = 1;
```

**Time-series data/TTL**:
```cpp
options.compaction_style = kCompactionStyleFIFO;
options.compaction_options_fifo.max_table_files_size = 100 * 1024 * 1024 * 1024; // 100GB
options.compaction_options_fifo.allow_compaction = true; // Allow minor compaction
options.ttl = 7 * 24 * 60 * 60; // 7 days
```

**Large Value (>1KB)**:
```cpp
options.enable_blob_files = true;
options.min_blob_size = 1024;
options.blob_file_size = 256 * 1024 * 1024;
options.enable_blob_garbage_collection = true;
```

### 7.4 Industrial-Grade Features

RocksDB provides rich enterprise-level features to meet production environment requirements:

**1. Multi-Version Concurrency Control (MVCC)**
- Snapshot isolation level, supports consistent reads
- Serializable transactions, guarantees strict execution order
- Deadlock detection and automatic resolution

**2. Backup and Recovery**
- Hot backup (BackupEngine): Create consistent snapshots without stopping service
- Incremental backup: Only backup changed data
- Point-in-time recovery: Restore to state at specified timestamp

**3. Checkpoint**
- Create lightweight consistent snapshots
- Based on hard links, completes almost instantaneously
- Used for quick backup or test environment cloning

**4. Tiered Storage (Hot-Cold Separation)**
- Support storing data from different levels on different media
- Hot data (L0-L2): SSD
- Cold data (L3+): HDD or object storage
- Automatic data tiered migration

**5. Compression Algorithm Selection**
- Snappy: Default, fast compression, suitable for general scenarios
- Zstd: High compression ratio, saves storage space
- LZ4: Extremely fast compression, suitable for CPU-constrained scenarios
- Support selecting different algorithms per level

**6. Bloom Filter Tuning**
- Full table filter: One Filter per SSTable
- Partition filter: Reduce memory usage, suitable for large SSTables
- Per-block filter: Precise to Data Block level

**7. Adaptive Compaction**
- Dynamically adjust Compaction rate based on workload
- Configurable rate limiting, avoid affecting foreground
- Priority scheduling, prioritize processing read-hot levels

**8. Column Families**
- Logical isolation of different data collections
- Independent Compaction strategy configuration per Column Family
- Support cross-Column Family atomic operations

**9. Monitoring and Diagnostics**
- Real-time statistics (Statistics): Operation counts, latency distribution
- Performance context (PerfContext): Detailed latency of single operation
- Tracing (Trace): Record operation sequence for diagnosis

**10. Write Throttling and Flow Control**
- Prevent writes from being too fast causing Compaction to fall behind
- Automatically reduce write rate, maintain system stability
- Configurable delayed write strategy

### 7.5 RocksDB Latest Progress (2024-2026)

> Note: This section involves RocksDB latest versions (v10.x - v11.x), some features are still rapidly iterating, please test thoroughly before production use.

#### 7.5.1 RocksDB v11.0 New Features (2026)

**Blob File Storage Wide-Column Entities**:
- **Background**: Supports HBase-like wide-column model, suitable for sparse column storage scenarios
- **Optimization**: `min_blob_size` configuration supports wide-column scenarios, automatic storage method selection
- **Benefit**: Reduce SST file size, improve read performance by 10-30%

**FIFO Compaction Enhancements**:
- **`max_data_files_size`**: Trim old files based on SST+blob total size
- **`use_kv_ratio_compaction`**: BlobDB-optimized intra-L0 compaction
- **Applicable Scenarios**: Time-series data, cache and other TTL-dominated workloads

**Interpolation Search**:
- **Configuration**: `index_block_search_type` new option
- **Principle**: Utilize key distribution patterns to predict position, fallback to binary search for non-uniform distribution
- **Performance**: Uniformly distributed keys (such as timestamps) can reduce comparison count by 30-50%

**Key-Value Separated Data Blocks**:
- **Configuration**: `separate_key_value_in_data_block` option
- **Benefit**: Improve CPU cache hit rate, improve compression ratio by 5-15%

#### 7.5.2 RocksDB v10.x Important Updates

| Version | Feature | Impact |
|---------|---------|--------|
| v10.7.0 | **HyperClockCache Default** | Replace LRU Cache, higher concurrent performance, reduced lock contention |
| v10.6.0 | **MultiScan API** | Multi-range scan optimization, reduce duplicate index lookups |
| v10.5.0 | **User-Defined Index (UDI)** | Support custom secondary indexes, flexibility improvement |
| v10.4.0 | **Parallel Compression Optimization** | `CompressionOptions::parallel_threads` accelerates compression |
| v10.0.0 | **Integrated BlobDB Complete** | Key-value separation functionality matured, recommended for production use |

#### 7.5.3 Frontier Research Directions

**Hardware Adaptation**:

**ZNS SSD (Zoned Namespace SSD)**:
- Characteristics: SSD divided into multiple Zones, can only write sequentially, requires explicit erase
- Optimization: LSM SSTables naturally aligned with Zones
- Benefit: Reduce SSD internal GC, extend lifespan, improve performance

**Persistent Memory (PMem)**:
- Characteristics: Byte-addressable, large capacity, non-volatile
- Optimization: PMem as large-capacity MemTable or L0 layer
- Benefit: Fast recovery, large-capacity buffering, reduced write amplification

**CXL Memory Expansion**:
- Characteristics: Expand memory pool via CXL protocol
- Optimization: Separate compute and storage, remote MemTable
- Benefit: Compute-storage separated architecture, elastic scaling

**Cloud-Native Optimization**:

**Compute-Storage Separation**:
- Compute nodes stateless, data stored in object storage (S3/OSS)
- SSTable tiering: Hot data local, cold data remote
- Challenges: Cold start latency, consistency guarantees

**Remote Compaction**:
- Offload Compaction tasks to dedicated compute nodes
- Release foreground node resources, improve service capacity
- Technical challenges: Network overhead, task scheduling

**Serverless LSM**:
- Launch LSM instances on demand, pay per query
- Data persisted in object storage
- Applicable: Low-frequency access, elastic demand scenarios

**New Data Structures**:

**Learned Index**:
- Use machine learning models to replace traditional B-Tree indexes
- Predict key position, reduce index size
- Challenges: Model training, dynamic updates, worst-case guarantees

**Adaptive Data Structures**:
- Automatically adjust structure based on workload
- Read-heavy → B-Tree mode
- Write-heavy → LSM mode
- Representatives: Dostoevsky, Fluid LSM-Tree

**Hardware Acceleration**:
- FPGA/GPU acceleration for Compaction
- Dedicated accelerators for compression/decompression
- Smart NIC offload network I/O

#### 7.5.4 Version Selection Recommendations

| Scenario | Recommended Version | Reason |
|----------|---------------------|--------|
| **Production Environment (Stability Priority)** | v8.x - v9.x LTS | Large-scale verified, comprehensive community support |
| **New Feature Requirements** | v10.x | Rich functionality, relatively mature, optimizations like HyperClockCache worth adopting |
| **Frontier Testing/Evaluation** | v11.x | Latest features, such as wide-column support, interpolation search, need thorough testing before production |

#### 7.5.5 Getting Latest Updates

- **GitHub Releases**: https://github.com/facebook/rocksdb/releases
- **RocksDB Blog**: https://rocksdb.org/blog/
- **Official Wiki**: https://github.com/facebook/rocksdb/wiki

---

## 8. LSM-Tree Optimization Technology Map


The three core performance metrics of LSM-Tree: **Write Amplification**, **Read Amplification**, **Space Amplification**. This chapter systematically organizes the complete optimization technology system for these three problems.

```
Root Causes of LSM-Tree Three Amplification Problems:

┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  Write Amplification                                         │
│  ├── Root: Repeatedly rewriting data during Compaction      │
│  ├── Impact: Reduces write throughput, shortens SSD lifespan │
│  └── Typical: LevelDB 12-50×, RocksDB 10-30×                │
│                                                              │
│  Read Amplification                                          │
│  ├── Root: Need to check multiple levels/files to find key  │
│  ├── Impact: Increases read latency, reduces random read    │
│  │          performance                                      │
│  └── Typical: LevelDB 3-14×, RocksDB 2-10×                  │
│                                                              │
│  Space Amplification                                         │
│  ├── Root: Invalid data not cleaned timely, low compression │
│  │          efficiency                                       │
│  ├── Impact: Wastes disk space, increases costs             │
│  └── Typical: LevelDB 1.2×, RocksDB 1.15×                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

### 8.1 Write Amplification Optimization

Write amplification is the most core performance problem of LSM-Tree, defined as **the ratio of actual data written to disk to user-written data**.

#### 8.1.1 Write Amplification Source Analysis

```
Three Major Sources of Write Amplification:

┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  1. Compaction Rewrite                                       │
│     ┌────────────────────────────────────────────────────┐  │
│     │ L0 → L1 Compaction Example:                         │  │
│     │                                                      │  │
│     │ L0: [File_A][File_B][File_C][File_D]               │  │
│     │              ↓ Merge                                 │  │
│     │ L1: [File_1][File_2][File_3]...[File_N]            │  │
│     │                                                      │  │
│     │ Input: 4 files × 2MB = 8MB                          │  │
│     │ Output: 10 files × 2MB = 20MB                       │  │
│     │ Write Amp: 20MB / 8MB = 2.5× (Only this level)     │  │
│     └────────────────────────────────────────────────────┘  │
│                                                              │
│  2. Bloom Filter Update                                      │
│     - Need to recalculate Bloom Filter for each Compaction  │
│     - Additional write overhead: ~5-10%                     │
│                                                              │
│  3. Index Rebuild                                            │
│     - Index Block and MetaIndex Block rebuild               │
│     - Additional write overhead: ~3-5%                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Overall Write Amplification Formula:
Write_Amp = Σ(Level_i_Size / Level_i-1_Size) × Compaction_Overhead
```

#### 8.1.2 Key-Value Separation Optimization

**Core Idea**: Compaction only cares about Key order, Value can be stored separately to avoid repeatedly rewriting large Values.

```
Key-Value Separation Architecture Comparison:

Traditional LSM:                    Key-Value Separated LSM:
┌──────────┐                       ┌──────────┐    ┌──────────┐
│ LSM-Tree │                       │ LSM-Tree │    │   vLog   │
│ Key+Value│                       │ Key+Addr │    │  (Value) │
└──────────┘                       └────┬─────┘    └────┬─────┘
       ▲                                │               │
       │                                └───────────────┘
  Write Amp 12-50×                    Write Amp ~1×   Sequential Append

Advantages:
1. Compaction only processes Key (usually 16-64 bytes)
2. Value directly appended to vLog, no movement
3. GC reclaims invalid Values in background, doesn't affect foreground writes
```

**Representative Implementations**:

| System | Proposal Time | Key Characteristics | Write Amp Reduction |
|--------|---------------|---------------------|---------------------|
| **WiscKey** | 2016 (FAST) | Academic pioneer, vLog + online GC | 12× → 1.2× (90%) |
| **Titan** | 2018 | TiKV engine, offline GC | 15× → 1.5× (90%) |
| **BlobDB** | 2020 | RocksDB integrated, production-ready | 15× → 2× (87%) |

**WiscKey Detailed Design**:

```cpp
// vLog format
struct LogEntry {
  uint32_t key_length;
  char[] key_data;
  uint32_t value_length;
  char[] value_data;
  uint32_t checksum;
};

// Address stored in LSM-Tree
struct BlobAddress {
  uint64_t file_number;    // vLog file number
  uint64_t offset;         // Offset in vLog
  uint32_t size;           // Value size
};

// GC process
void GarbageCollection() {
  while (true) {
    // 1. Sequentially read chunk from Tail
    entries = ReadChunk(tail_file);
    
    // 2. Verify if each Key-Value is still valid
    valid_entries = [];
    for (entry : entries) {
      if (LSM.Lookup(entry.key) == entry.address) {
        valid_entries.push(entry);  // Still referenced
      }
    }
    
    // 3. Append valid data to Head
    for (entry : valid_entries) {
      new_addr = AppendToHead(entry.key, entry.value);
      LSM.Update(entry.key, new_addr);
    }
    
    // 4. Update Tail, release space
    tail_file = next_file();
  }
}
```

**Bloom Filter Effect Quantification**:

| bits_per_key | False Positive Rate | Memory Overhead (per million keys) | Reduced Disk Reads |
|--------------|---------------------|-----------------------------------|-------------------|
| 5 | 5.0% | 0.625 MB | 85% |
| 8 | 1.0% | 1.0 MB | 90% |
| 10 | 0.8% | 1.25 MB | 92% |
| 15 | 0.05% | 1.875 MB | 94.5% |

**False Positive Rate Formula**:
```
P(false positive) ≈ (1 - e^(-k*n/m))^k

Where:
- n = number of keys
- m = total bits
- k = number of hash functions ≈ 0.693 * (m/n)
- bits_per_key = m/n

LevelDB/RocksDB default bits_per_key = 10
→ k ≈ 7 hash functions
→ False positive rate ≈ 0.8%
```

#### 8.1.3 Data Structure Optimization

**PebblesDB FLSM (Fragmented LSM)**:

```
FLSM vs Traditional LSM Comparison:

Traditional LSM (Disjoint SSTables):
Level 1: [1-100][200-300]  ← key ranges non-overlapping
              ↑
         Must rewrite entire range during Compaction

FLSM (Overlap Allowed):
Level 1: Guard:50 ──── Guard:200
         │                │
      [1-60]           [150-250]
      [20-80]          [180-300]
      [40-100]         [200-350]
      ↑ Overlap allowed
      Only partition during Compaction, no rewrite!

Guard Mechanism:
- Guard: Randomly selected partition point from inserted keys
- Guards are disjoint, sstables within Guard can overlap
- Higher levels contain all Guards from lower levels (similar to Skip List)
```

**FLSM Compaction Process**:

```
Traditional LSM Compaction:        FLSM Compaction:
1. Read sstable                   1. Select Guard (sstables exceed threshold)
2. Merge and sort                 2. Partition by lower level Guards
3. Write new sstables             3. Direct append (no sorting!)
4. Delete old files               4. Delete old files

→ Data rewrite!                   → Only partition, no rewrite!

Write Amp Comparison:
- Traditional LSM: 18.7×
- PebblesDB (FLSM): 3.9× (79% reduction)
```

**Other Data Structure Optimizations**:

| Technology | Principle | Write Amp Reduction | Representative System |
|------------|-----------|---------------------|----------------------|
| **LSM-trie** | Trie structure reduces overlap | 15× → 6× (60%) | Research prototype |
| **Dostoevsky** | Segmented LSM, delayed merge | 20× → 8× (60%) | Research prototype |
| **HashKV** | Hash partitioning, local Compaction | 18× → 7× (61%) | Research prototype |

#### 8.1.4 Compaction Strategy Optimization

**Four Mainstream Compaction Strategies Comparison**:

```
1. Leveled Compaction (LevelDB Default)

   L0: [A-M] [N-Z]           ← 4 files trigger
        ↓ Merge
   L1: [A-F] [G-L] [M-R] [S-Z]  ← Output fully sorted

   Characteristics:
   - Each level fully sorted, adjacent level size ratio 10:1
   - Lowest read amplification (O(1))
   - Highest write amplification (10-30×)
   - Applicable: Read-heavy scenarios

2. Tiered Compaction (RocksDB Universal)

   L0: [A-C] [D-F] [G-I] [J-L]  ← 4 sorted runs
        ↓ Delayed merge
   L1: [A-L]                     ← One-time merge

   Characteristics:
   - Each level allows multiple sorted runs
   - Lowest write amplification (2-5×)
   - Highest read amplification (O(T), T=number of runs)
   - Applicable: Write-heavy scenarios

3. Leveled-N (Hybrid Strategy)

   L0-L2: Tiered style          ← Lower level delayed merge
   L3-L6: Leveled style         ← Higher level strict sorting

   Characteristics:
   - Balance read/write amplification
   - Write amplification: 5-10×
   - Read amplification: 2-5×
   - Applicable: Mixed workloads

4. FIFO Compaction

   Keep only recent N files, delete when exceeded

   Characteristics:
   - Extremely low write amplification (~1×)
   - Extremely high read amplification
   - Extremely high space amplification
   - Applicable: Time-series data, cache
```

**Compaction Strategy Selection Decision Tree**:

```
Start
  │
  ▼
Workload Type?
  │
  ├── Read-dominated (Read > 80%)
  │   └──▶ Leveled Compaction
  │        - Low read amplification
  │        - Acceptable high write amplification
  │
  ├── Write-dominated (Write > 80%)
  │   ├──▶ Tiered Compaction
  │   │    - Low write amplification
  │   │    - Acceptable high read amplification
  │   │
  │   └──▶ FLSM (PebblesDB)
  │        - Extremely low write amplification
  │        - Medium read amplification
  │
  ├── Mixed workload
  │   └──▶ Leveled-N or Tuned Leveled
  │        - Dynamically adjust parameters
  │        - Balance read/write
  │
  └── Time-series data/Cache
      └──▶ FIFO Compaction
           - Only keep latest data
           - Minimal Compaction
```

#### 8.1.5 Write Amplification Optimization Technology Summary

```
Write Amplification Optimization Technology Map:

┌─────────────────────────────────────────────────────────────┐
│                      Write Amplification Optimization        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ├── Key-Value Separation                                    │
│  │   ├── WiscKey (vLog + Online GC)                         │
│  │   ├── Titan (TiKV, Offline GC)                           │
│  │   └── RocksDB BlobDB (Industrial Implementation)         │
│  │       ├── enable_blob_files = true                       │
│  │       ├── min_blob_size = 4096 (Separate above 4KB)      │
│  │       └── blob_garbage_collection = true                 │
│  │                                                           │
│  ├── Data Structure Optimization                             │
│  │   ├── PebblesDB (FLSM + Guards)                          │
│  │   │   ├── Partition Compaction (Partition only)          │
│  │   │   └── Rewrite Compaction (Sort when necessary)       │
│  │   ├── LSM-trie (Trie structure reduces overlap)          │
│  │   └── Dostoevsky (Segmented LSM)                         │
│  │                                                           │
│  └── Compaction Strategy                                     │
│      ├── Tiered Compaction (Delayed merge)                   │
│      ├── Leveled-N (Hybrid strategy)                         │
│      ├── FIFO (Only keep latest)                             │
│      └── TRIAD (Delayed Compaction)                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Optimization Effect Comparison (Based on LevelDB 12×):

| Optimization Technology | Write Amp | Reduction | Cost |
|------------------------|-----------|-----------|------|
| No optimization (LevelDB) | 12× | - | - |
| RocksDB (Multi-threaded) | 15× | -25% | CPU overhead +20% |
| Tiered Compaction | 5× | 58% | Read Amp +3× |
| PebblesDB (FLSM) | 4× | 67% | Read Amp +2× |
| BlobDB (4KB+) | 2× | 83% | Random read latency +30% |
| WiscKey (4KB+) | 1.2× | 90% | Range query -20% |
```

---

### 8.2 Read Amplification Optimization

Read amplification is defined as **the ratio of actual data read to requested data**, directly affecting read latency.

#### 8.2.1 Read Amplification Source Analysis

```
Three Major Sources of Read Amplification:

┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  1. Multi-Level Lookup                                       │
│     ┌────────────────────────────────────────────────────┐  │
│     │ Get(key) Lookup Path:                               │  │
│     │                                                      │  │
│     │ 1. MemTable (O(log n))                              │  │
│     │    ↓ Not Found                                      │  │
│     │ 2. Immutable MemTable (At most 2)                   │  │
│     │    ↓ Not Found                                      │  │
│     │ 3. Level 0 SSTables (At most 4, check one by one)   │  │
│     │    ↓ Not Found                                      │  │
│     │ 4. Level 1+ (Binary search to locate file each level)│  │
│     │                                                      │  │
│     │ Worst case: 1 + 2 + 4 + 6 = 13 file lookups         │  │
│     └────────────────────────────────────────────────────┘  │
│                                                              │
│  2. In-Block Scan                                            │
│     - Data Block default 4KB, need to scan to find key      │
│     - Optimized through Restart Points, still partial scan  │
│                                                              │
│  3. Merge Operator                                           │
│     - Merge type needs to collect multiple versions and merge│
│     - May span multiple SSTables                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Total Read Amplification Formula:
Read_Amp = Σ(Levels_Checked) × Files_Per_Level × (1 - Bloom_Hit_Rate)
```

#### 8.2.2 Filtering Optimization

**Bloom Filter Multi-Level Deployment**:

```
Bloom Filter Three-Level Deployment:

┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  Level 1: Whole Table Filter (Whole Key Filter)             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ SSTable Footer                                        │  │
│  │   └─→ Filter Block Handle                             │  │
│  │        └─→ [Filter for entire table]                  │  │
│  │                                                       │  │
│  │ Advantage: One Filter covers entire table, low memory │  │
│  │ Disadvantage: Relatively high false positive rate     │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  Level 2: Partitioned Filter (Partitioned Filter)           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ MetaIndex Block                                       │  │
│  │   ├─→ Filter Partition 0 [keys 0-999]                 │  │
│  │   ├─→ Filter Partition 1 [keys 1000-1999]             │  │
│  │   └─→ Filter Partition N [...]                        │  │
│  │                                                       │  │
│  │ Advantage: Load partitions on demand, reduce memory   │  │
│  │ Disadvantage: Increased implementation complexity     │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  Level 3: Block Filter (Block Filter)                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ One Filter per Data Block                              │  │
│  │   Data Block 0 → Filter 0                             │  │
│  │   Data Block 1 → Filter 1                             │  │
│  │                                                       │  │
│  │ Advantage: Lowest false positive rate, precise        │  │
│  │ Disadvantage: Highest memory usage                    │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Configuration Example (RocksDB):
options.optimize_filters_for_hits = true;        // Optimize for hit rate
options.partition_filters = true;                // Enable partitioned filter
options.cache_index_and_filter_blocks = true;    // Cache filter
```

**Prefix Bloom Filter**:

```
Optimization for Prefix Query:

Scenario: Large number of queries share same prefix
Example: user:1001, user:1002, user:1003...

Traditional Bloom Filter:
- Store complete key: "user:1001", "user:1002"...
- Query: Must provide complete key

Prefix Bloom Filter:
- Only store prefix: "user:1001" → "1001"
- Query: Can quickly exclude using prefix

Implementation:
1. Configure prefix_extractor
2. Build Bloom Filter for each prefix in MemTable
3. Carry prefix Filter when flushing to SSTable

Effect:
- Prefix query speed improvement 5-10×
- Memory usage reduced 30-50%
```

#### 8.2.3 Cache Optimization

**Multi-Level Cache Architecture**:

```
RocksDB Four-Level Cache System:

┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  L1: Row Cache (Optional)                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Cache complete Key-Value pairs                         │  │
│  │                                                        │  │
│  │ Hit: Direct return, no disk I/O                       │  │
│  │ Miss: Continue lookup below                           │  │
│  └───────────────────────────────────────────────────────┘  │
│                         ↓ Miss                               │
│  L2: Block Cache (Core)                                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Cache Data Block, Index Block, Filter Block           │  │
│  │                                                        │  │
│  │ Implementation: LRU / HyperClockCache (RocksDB v10.7+)│  │
│  │ Size: Usually set to 30-50% of available memory       │  │
│  │ Hit rate target: > 90%                                │  │
│  └───────────────────────────────────────────────────────┘  │
│                         ↓ Miss                               │
│  L3: Table Cache                                            │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Cache SSTable metadata (Footer, Index Block pointers) │  │
│  │                                                        │  │
│  │ Function: Avoid repeated file open, reduce stat()     │  │
│  │ Size: Usually 1000-10000 table handles                │  │
│  └───────────────────────────────────────────────────────┘  │
│                         ↓ Miss                               │
│  L4: OS Page Cache                                          │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Operating system level file cache                     │  │
│  │                                                        │  │
│  │ RocksDB utilizes via mmap or direct I/O               │  │
│  │ Size: Remaining available memory                      │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Cache Hit Rate Impact on Read Amplification:

| Cache Level | Hit Rate | Effective Read Amp |
|-------------|----------|-------------------|
| Row Cache 90% | 90% | 1.3× |
| Block Cache 90% | 90% | 2.5× |
| OS Cache Only | 50% | 6.0× |
| No Cache | 0% | 12× |
```

**HyperClockCache (RocksDB v10.7+)**:

```cpp
// Replace traditional LRU Cache, higher concurrent performance

Traditional LRU Cache Problems:
- Severe global lock contention
- Performance drops significantly under high concurrency
- Clock algorithm variant, lock-free design

HyperClockCache Advantages:
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  1. Lock-Free Concurrency                                    │
│     - Use atomic operations and CAS                         │
│     - Support hundreds of threads concurrent access         │
│                                                              │
│  2. Adaptive Eviction                                        │
│     - Based on access frequency and time                    │
│     - Automatically adjust eviction strategy                │
│                                                              │
│  3. NUMA Awareness                                           │
│     - Prioritize access to local NUMA node                  │
│     - Reduce cross-node memory access                       │
│                                                              │
│  Performance Improvement:                                    │
│  - 32 threads concurrent: 2.5× faster than LRU              │
│  - 64 threads concurrent: 4× faster than LRU                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 8.2.4 Index Optimization

**Index Block Two Search Methods**:

```
1. Binary Search (Default)

   ┌───────────────────────────────────────────────────────┐
   │ Index Block Structure:                                 │
   │                                                        │
   │ [Key: "apple"]  → BlockHandle(offset: 0, size: 4KB)   │
   │ [Key: "banana"] → BlockHandle(offset: 4KB, size: 4KB) │
   │ [Key: "cherry"] → BlockHandle(offset: 8KB, size: 4KB) │
   │ ...                                                    │
   │                                                        │
   │ Search Process:                                        │
   │ 1. Binary search in Index Block                        │
   │ 2. Find first Entry >= target_key                      │
   │ 3. Read corresponding Data Block                       │
   │                                                        │
   │ Time Complexity: O(log N), N=Data Block count          │
   │ Applicable: Range queries, prefix queries              │
   └───────────────────────────────────────────────────────┘

2. Hash Search (Configuration enabled)

   ┌───────────────────────────────────────────────────────┐
   │ Hash Index Structure:                                  │
   │                                                        │
   │ Bucket 0 → [hash("apple"), BlockHandle]              │
   │ Bucket 1 → [hash("banana"), BlockHandle]             │
   │ Bucket 2 → [hash("cherry"), BlockHandle]             │
   │                                                        │
   │ Search Process:                                        │
   │ 1. Calculate hash value of key                         │
   │ 2. Directly locate corresponding Bucket                │
   │ 3. Read corresponding Data Block                       │
   │                                                        │
   │ Time Complexity: O(1)                                  │
   │ Applicable: Pure point query workloads                 │
   │ Not applicable: Range queries                          │
   └───────────────────────────────────────────────────────┘

Configuration:
BlockBasedTableOptions::index_type = kHashSearch;  // Enable hash index
```

**Interpolation Search (Interpolation Search, RocksDB v11.0+)**:

```
Interpolation Search Principle:

Prerequisite: Keys uniformly distributed (e.g., timestamps, auto-increment IDs)

Traditional Binary Search:
  mid = (low + high) / 2
  
Interpolation Search:
  mid = low + ((target - keys[low]) / (keys[high] - keys[low])) * (high - low)
  
  Predict position based on target value, not fixed midpoint

Example:
Keys: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
Target: 850

Binary Search:
  1st: mid = 5 (600) < 850, go right
  2nd: mid = 7 (800) < 850, go right
  3rd: mid = 8 (900) > 850, go left
  4th: Found 850

Interpolation Search:
  Predicted position = 0 + ((850-100)/(1000-100)) * 9 = 7.5 ≈ 8
  1st: Directly locate to index 8 (900)
  2nd: Go left to find 850
  
  Only 2 comparisons needed!

Performance Improvement:
- Uniformly distributed keys: Reduce comparison count by 30-50%
- Non-uniform distribution: Automatically fallback to binary search
- Configuration: index_block_search_type = kInterpolationSearch
```

#### 8.2.5 Parallelization Optimization

**WiscKey Parallel Range Query**:

```
Problem: After key-value separation, range queries require multiple random reads to vLog

Solution: Utilize SSD parallel random read capability

┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  Serial Method (Traditional):                                │
│  GetRange(start, end):                                      │
│  1. Find keys in LSM: [k1, k2, k3, ..., kn]                 │
│  2. for each key:                                           │
│       addr = LSM.lookup(key)                                │
│       value = vLog.read(addr)  ← Sequential, n I/Os         │
│                                                              │
│  Total latency: n × t_random (t_random ≈ 100μs for SSD)    │
│                                                              │
│  Parallel Method (WiscKey):                                  │
│  1. Find keys in LSM: [k1, k2, k3, ..., kn]                 │
│  2. Create 32 background threads                            │
│  3. Batch submit vLog read requests                         │
│  4. Wait for all to complete, return in order               │
│                                                              │
│  Total latency: (n/32) × t_random ≈ 3% × n × t_random      │
│                                                              │
│  Performance Improvement:                                    │
│  - 4KB value: 14×                                           │
│  - 16KB value: 16×                                          │
│  - 64KB value: 14×                                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**RocksDB MultiGet**:

```cpp
// Batch point query optimization

// Traditional method (n independent Gets)
for (int i = 0; i < n; i++) {
  db->Get(key[i], &value[i]);  // n system calls, n lookups
}

// MultiGet method (1 batch Get)
std::vector<Slice> keys = {key1, key2, ..., keyn};
std::vector<PinnableSlice> values(n);
std::vector<Status> statuses = db->MultiGet(keys, &values);

// Optimization points:
// 1. One system call, reduce context switching
// 2. Shared MemTable/SSTable iterators
// 3. Batch read consecutive Data Blocks
// 4. Merged Bloom Filter checks

Performance Improvement:
- Compared to n independent Gets: 3-5× faster
- Suitable: Batch point query scenarios (e.g., query by ID list)
```

#### 8.2.6 Read Amplification Optimization Technology Summary

```
Read Amplification Optimization Technology Map:

┌─────────────────────────────────────────────────────────────┐
│                      Read Amplification Optimization         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ├── Filtering                                               │
│  │   ├── Bloom Filter                                       │
│  │   │   ├── Whole Table Level (Entire SST)                 │
│  │   │   ├── Partition Level (Each partition)               │
│  │   │   └── Block Level (Each data block)                  │
│  │   ├── Prefix Bloom Filter                                │
│  │   │   └── Optimize for prefix queries                    │
│  │   └── Index Pruning                                      │
│  │       ├── Range Index                                    │
│  │       └── Time Index                                     │
│  │                                                           │
│  ├── Caching                                                 │
│  │   ├── Block Cache (LRU/HyperClockCache)                  │
│  │   ├── Table Cache (Metadata cache)                       │
│  │   ├── Index Block Cache                                  │
│  │   └── Filter Block Cache                                 │
│  │                                                           │
│  ├── Parallelization                                         │
│  │   ├── Parallel Seek (PebblesDB)                          │
│  │   │   └── Multi-thread search of sstables within Guard   │
│  │   ├── Multi-thread Range Query (WiscKey)                 │
│  │   │   └── 32 threads parallel read vLog                  │
│  │   └── MultiGet (Batch fetch)                             │
│  │                                                           │
│  └── Index Optimization                                      │
│      ├── Interpolation Search (RocksDB v11.0)               │
│      │   └── Better than binary search for uniform keys      │
│      ├── Hash Index                                          │
│      │   └── O(1) point query, no range query support        │
│      └── Adaptive Index                                      │
│          └── Auto-select based on workload                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Optimization Effect Comparison (Based on LevelDB Read Amp 10×):

| Optimization Technology | Read Amp | Reduction | Cost |
|------------------------|----------|-----------|------|
| No optimization (LevelDB) | 10× | - | - |
| + Bloom Filter (10bpk) | 3× | 70% | Memory 1.25MB/million keys |
| + Block Cache (90% hit) | 2× | 80% | Memory usage |
| + HyperClockCache | 1.8× | 82% | CPU +5% |
| + Parallel range query | 1.5× | 85% | Thread overhead |
| WiscKey (Large value) | 1.2× | 88% | Range query -20% |
```

---

### 8.3 Space Amplification Optimization

Space amplification is defined as **the ratio of actual disk usage to effective data volume**, directly affecting storage costs.

#### 8.3.1 Space Amplification Source Analysis

```
Three Major Sources of Space Amplification:

┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  1. Invalid Data Accumulation                                │
│     ┌────────────────────────────────────────────────────┐  │
│     │ Scenario: Frequent Update/Delete                    │  │
│     │                                                      │  │
│     │ T0: Put(k1, v1)  → SSTable_A                        │  │
│     │ T1: Put(k1, v2)  → SSTable_B (v1 not cleaned)       │  │
│     │ T2: Put(k1, v3)  → SSTable_C (v1,v2 not cleaned)    │  │
│     │ T3: Delete(k1)   → SSTable_D (v1,v2,v3 not cleaned) │  │
│     │                                                      │  │
│     │ Valid data: 0 (deleted)                             │  │
│     │ Actual usage: 4 versions × size                     │  │
│     │ Space Amp: ∞ (Infinite)                             │  │
│     └────────────────────────────────────────────────────┘  │
│                                                              │
│  2. Low Compression Efficiency                               │
│     - No compression: 1.0× (No savings)                      │
│     - Snappy: 1.3-1.5× (Save 30-40%)                         │
│     - Zstd: 1.1-1.3× (Save 50-60%)                           │
│                                                              │
│  3. Metadata Overhead                                        │
│     - InternalKey: +8 bytes/key (seq+type)                   │
│     - Bloom Filter: 1.25MB/million keys                      │
│     - Index Block: ~5-10% additional space                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Total Space Amplification Formula:
Space_Amp = (Raw_Data + Metadata + Invalid_Data) / Effective_Data
```

#### 8.3.2 Compression Optimization

**Compression Algorithm Comparison**:

```
┌─────────────────────────────────────────────────────────────┐
│                   Compression Algorithm Performance Comparison│
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Algorithm  Ratio   Compress Speed  Decompress Speed  CPU   │
│  ─────────────────────────────────────────────────────────   │
│  None      1.0×     ∞              ∞              0%        │
│  Snappy    1.3-1.5× 200MB/s        400MB/s        Low       │
│  LZ4       1.3-1.6× 400MB/s        800MB/s        Low       │
│  Zstd      1.5-2.5× 100MB/s        300MB/s        Medium    │
│  Bzip2     2.0-3.0× 50MB/s         150MB/s        High      │
│                                                              │
│  Compression Ratio Test (TPC-H Dataset):                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Original: 100 GB                                     │   │
│  │ Snappy:  68 GB  (Save 32%)                           │   │
│  │ LZ4:     65 GB  (Save 35%)                           │   │
│  │ Zstd:    45 GB  (Save 55%)                           │   │
│  │ Bzip2:   38 GB  (Save 62%)                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Recommended Configuration:                                  │
│  options.compression = kSnappyCompression;  // Default      │
│  options.bottommost_compression = kZSTD;    // Bottom level │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Tiered Compression Strategy**:

```
Different compression algorithms for different levels:

┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  Level 0-1 (Hot Data):                                      │
│  - Frequently accessed, frequent Compaction                 │
│  - Use Snappy (Fast, low CPU overhead)                      │
│  - Compression ratio: 1.3×                                  │
│                                                              │
│  Level 2-4 (Warm Data):                                     │
│  - Medium access frequency                                  │
│  - Use Zstd (Balance compression ratio and speed)           │
│  - Compression ratio: 1.8×                                  │
│                                                              │
│  Level 5-6 (Cold Data):                                     │
│  - Rarely accessed, long-term storage                       │
│  - Use Zstd high compression level or Bzip2                 │
│  - Compression ratio: 2.5×                                  │
│                                                              │
│  Configuration:                                              │
│  options.compression_per_level = {                          │
│    kSnappyCompression,  // L0                               │
│    kSnappyCompression,  // L1                               │
│    kZSTDCompression,    // L2                               │
│    kZSTDCompression,    // L3                               │
│    kZSTDCompression,    // L4                               │
│    kBZip2Compression,   // L5                               │
│    kBZip2Compression,   // L6                               │
│  };                                                         │
│                                                              │
│  Effect: Overall space saving 40-50%, CPU overhead +10-15%  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 8.3.3 Garbage Collection Optimization

**Timely Compaction**:

```
Accelerate invalid data cleanup by adjusting Compaction parameters:

┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  Parameter Tuning:                                           │
│                                                              │
│  1. level0_file_num_compaction_trigger (Default 4)          │
│     ↓ Reduce to 2                                           │
│     Effect: More frequent L0→L1 Compaction triggers,        │
│             faster invalid data cleanup                     │
│     Cost: Write amplification increases 20-30%              │
│                                                              │
│  2. max_bytes_for_level_base (Default 256MB)                │
│     ↓ Reduce to 128MB                                       │
│     Effect: Reduced capacity per level, more aggressive     │
│             Compaction                                      │
│     Cost: Increased Compaction frequency                    │
│                                                              │
│  3. periodic_compaction_seconds (RocksDB 6.29+)             │
│     Set to 7 days (604800 seconds)                          │
│     Effect: Force Compaction on all data every 7 days       │
│     Applicable: Periodic cleanup of expired data            │
│                                                              │
│  Monitoring Metrics:                                         │
│  - rocksdb.estimate-num-deletes: Estimated delete markers   │
│  - rocksdb.estimate-live-data-size: Estimated valid data    │
│                                                              │
│  When delete_ratio > 20%, recommend manual Compaction:      │
│  db->CompactRange(compact_options, nullptr, nullptr);       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key-Value Separation GC**:

```
Comparison of GC Mechanisms for WiscKey/Titan/BlobDB:

┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  WiscKey (Online GC):                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Trigger: Background periodic operation               │   │
│  │                                                      │   │
│  │ Process:                                              │   │
│  │ 1. Sequentially read chunk from Tail (256KB)         │   │
│  │ 2. For each entry, check if LSM still points to addr │   │
│  │ 3. Append valid entries to Head                      │   │
│  │ 4. Update Tail, release old files                    │   │
│  │                                                      │   │
│  │ Advantage: GC doesn't affect foreground I/O          │   │
│  │ Disadvantage: Complex implementation, vLog state     │   │
│  │             machine maintenance                      │   │
│  │                                                      │   │
│  │ Performance impact: Throughput drop < 10% even with  │   │
│  │                   100% invalid data                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Titan (Offline GC):                                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Trigger: Synchronized with Compaction                │   │
│  │                                                      │   │
│  │ Process:                                              │   │
│  │ 1. Compaction reads blob addresses from SSTable      │   │
│  │ 2. Read corresponding values from vLog               │   │
│  │ 3. Only write valid values to new vLog               │   │
│  │ 4. Update addresses in SSTable                       │   │
│  │                                                      │   │
│  │ Advantage: Simple implementation, natural integration│   │
│  │            with Compaction                           │   │
│  │ Disadvantage: Increased I/O pressure during          │   │
│  │             Compaction                               │   │
│  │                                                      │   │
│  │ Performance impact: Compaction time extended 30-50%  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  BlobDB (RocksDB Integrated):                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Trigger: Configurable, supports online + offline     │   │
│  │        mixed                                         │   │
│  │                                                      │   │
│  │ Special Features:                                     │   │
│  │ - use_kv_ratio_compaction: Optimize based on key/    │   │
│  │   value ratio                                        │   │
│  │ - max_data_files_size: Prune based on SST+blob       │   │
│  │   total size                                         │   │
│  │ - intra-L0 compaction: Merge L0 internal blob files  │   │
│  │                                                      │   │
│  │ Configuration Example:                                │   │
│  │ options.enable_blob_files = true;                    │   │
│  │ options.min_blob_size = 4096;  // Separate above 4KB │   │
│  │ options.blob_file_size = 256MB;                      │   │
│  │ options.enable_blob_garbage_collection = true;       │   │
│  │ options.blob_garbage_collection_age_cutoff = 0.25;   │   │
│  │                                                      │   │
│  │ Effect: Space amplification reduced from 1.5× to     │   │
│  │       1.05× (97% reduction)                          │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 8.3.4 Deduplication Optimization

**HashKV Hash Partition Deduplication**:

```
HashKV Core Idea: Keys with same hash go to same partition, localize deduplication

┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  Traditional LSM:                                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ All keys mixed together                               │   │
│  │ Compaction requires global scan                       │   │
│  │ Difficult to identify duplicate data                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  HashKV:                                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Partition 0: hash(key) % 100 == 0                    │   │
│  │   [key: "user:100", val: "v1"]                       │   │
│  │   [key: "user:100", val: "v2"]  ← Duplicate found!   │   │
│  │   [key: "user:200", val: "v1"]                       │   │
│  │                                                      │   │
│  │ Partition 1: hash(key) % 100 == 1                    │   │
│  │   [key: "user:101", val: "v1"]                       │   │
│  │   ...                                                │   │
│  │                                                      │   │
│  │ Deduplication process:                               │   │
│  │ 1. Detect duplicates within each partition during    │   │
│  │    Compaction                                        │   │
│  │ 2. Only keep latest version, delete old versions     │   │
│  │ 3. Generate deduplicated SSTable                     │   │
│  │                                                      │   │
│  │ Effect: Space amplification reduced from 1.8× to     │   │
│  │       1.2× (67% reduction)                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 8.3.5 Space Amplification Optimization Technology Summary

```
Space Amplification Optimization Technology Map:

┌─────────────────────────────────────────────────────────────┐
│                      Space Amplification Optimization        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ├── Compression                                             │
│  │   ├── Snappy (Default, ~200MB/s)                        │
│  │   ├── Zstd (High compression, ~100MB/s)                 │
│  │   ├── LZ4 (Fast, ~400MB/s)                              │
│  │   └── Bzip2 (Highest compression, ~50MB/s)              │
│  │                                                           │
│  ├── Garbage Collection                                      │
│  │   ├── Timely Compaction                                  │
│  │   │   ├── Reduce trigger threshold                      │
│  │   │   └── Periodic Compaction                            │
│  │   ├── vLog GC (Key-value separation)                     │
│  │   │   ├── WiscKey (Online GC)                           │
│  │   │   ├── Titan (Offline GC)                            │
│  │   │   └── BlobDB (Hybrid GC)                            │
│  │   └── Background cleanup threads                         │
│  │                                                           │
│  └── Deduplication                                           │
│      ├── HashKV (Hash partition deduplication)              │
│      ├── Global deduplication                                │
│      └── Local deduplication                                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Optimization Effect Comparison (Based on LevelDB space amplification 1.2×):

| Optimization Technology | Space Amp | Improvement | Cost |
|------------------------|-----------|-------------|------|
| No optimization (LevelDB) | 1.2× | - | - |
| + Zstd compression | 1.08× | 10% | CPU +10% |
| + Timely Compaction | 1.05× | 12.5% | Write amplification +20% |
| + BlobDB GC | 1.02× | 15% | Random read +30% |
| + HashKV deduplication | 1.01× | 16% | Memory +5% |

Comprehensive optimization case:
A log storage system, original data 1TB:
- Before optimization: 1.5TB disk usage (space amplification 1.5×)
- Enable Zstd: 1.2TB (1.2×)
- Enable BlobDB: 1.05TB (1.05×)
- Enable periodic Compaction: 1.02TB (1.02×)
- Final savings: 480GB disk space, annual cost savings $5000+
```

---

### 8.4 Synergy of Three Optimization Techniques

In practical systems, write amplification, read amplification, and space amplification constrain each other and require comprehensive trade-offs.

```
Trade-off Triangle:

                    Write Amplification
                     / \
                    /   \
                   /     \
                  /       \
                 /         \
                /           \
            Read Amp ←────→ Space Amp

Typical Trade-off Scenarios:

1. Reduce Write Amp ↔ Increase Read Amp
   - Tiered Compaction: Write Amp↓, Read Amp↑
   - Key-value separation: Write Amp↓↓, Random Read↑

2. Reduce Write Amp ↔ Increase Space Amp
   - Delayed Compaction: Write Amp↓, Space Amp↑
   - FIFO strategy: Write Amp↓↓, Space Amp↑↑

3. Reduce Read Amp ↔ Increase Space Amp
   - Bloom Filter: Read Amp↓, Memory↑
   - More cache: Read Amp↓, Memory↑

Optimal Strategy:
Choose the appropriate balance point based on specific workload!
```

**Workload-Driven Optimization Selection**:

```
┌─────────────────────────────────────────────────────────────┐
│                  Optimization Strategies for Different      │
│                  Scenarios                                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Scenario 1: Write-heavy, Read-light (Log storage,          │
│              Monitoring data)                                │
│  ├── Main conflict: Write amplification                      │
│  ├── Recommended: Tiered Compaction + BlobDB                │
│  ├── Acceptable cost: Slightly higher read amp,             │
│  │                     Slightly higher space amp             │
│  └── Expected effect: Write Amp 2-3×, Read Amp 5-8×,        │
│                     Space Amp 1.1×                          │
│                                                              │
│  Scenario 2: Read-heavy, Write-light (Config center,        │
│              Metadata storage)                               │
│  ├── Main conflict: Read amplification                       │
│  ├── Recommended: Leveled Compaction + Large Block Cache    │
│  ├── Acceptable cost: Slightly higher write amp             │
│  └── Expected effect: Write Amp 15-20×, Read Amp 1.5-2×,    │
│                     Space Amp 1.1×                          │
│                                                              │
│  Scenario 3: Large Value Storage (Object storage,           │
│              Document database)                              │
│  ├── Main conflict: Write amplification + Space             │
│  │                   amplification                            │
│  ├── Recommended: Key-value separation (WiscKey/Titan/      │
│  │                BlobDB)                                     │
│  ├── Acceptable cost: Slightly higher random read latency   │
│  └── Expected effect: Write Amp 1-2×, Read Amp 2-3×,        │
│                     Space Amp 1.05×                         │
│                                                              │
│  Scenario 4: Time-series Data (Metrics monitoring,          │
│              IoT data)                                       │
│  ├── Main conflict: Write throughput + Storage cost         │
│  ├── Recommended: FIFO Compaction + Tiered compression      │
│  ├── Acceptable cost: Historical data may be quickly        │
│  │                     cleaned                                │
│  └── Expected effect: Write Amp 1×, Read Amp 3-5×,          │
│                     Space Amp 1.1×                          │
│                                                              │
│  Scenario 5: Mixed Workload (E-commerce, Social            │
│              networks)                                       │
│  ├── Main conflict: Balance read/write                      │
│  ├── Recommended: Leveled-N + Moderate key-value            │
│  │                separation                                  │
│  ├── Acceptable cost: Increased implementation complexity   │
│  └── Expected effect: Write Amp 5-8×, Read Amp 2-3×,        │
│                     Space Amp 1.1×                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Chapter 9: Performance Comparison Summary

### 9.1 Core Metrics Comparison Across Systems

| System | Year | Write Amp | Read Amp | Main Optimization | Applicable Scenario |
|--------|------|-----------|----------|-------------------|---------------------|
| **LSM-Tree** | 1996 | Theoretical model | Theoretical model | Sequential write | Theoretical foundation |
| **LevelDB** | 2011 | 12-50× | 3-14× | Engineering simplification | Embedded |
| **RocksDB** | 2012 | 10-30× | 2-10× | Multi-threading, Rich features | Industrial general purpose |
| **WiscKey** | 2016 | ~1× | ~1×+1 | Key-value separation | Large value |
| **PebblesDB** | 2017 | 3-4× | Medium | FLSM | High-throughput writes |
| **Titan** | 2018 | ~1× | ~1×+1 | Key-value separation | TiKV ecosystem |
| **BlobDB** | 2020 | 2-5× | 2-5× | Industrial-grade key-value separation | RocksDB ecosystem |

### 9.2 Quantified Optimization Effects

Using LevelDB as baseline (100%), compare effects of various optimization schemes:

**Write Throughput (Random Write, MB/s)**:
| System | Throughput | Relative to Baseline |
|--------|------------|---------------------|
| LevelDB | 10 | 100% |
| RocksDB | 15 | 150% |
| PebblesDB | 27 | 270% |
| WiscKey (4KB value) | 350 | 3500% |
| BlobDB (4KB value) | 400 | 4000% |

**Write Amplification (Lower is better)**:
| System | Write Amp | Reduction |
|--------|-----------|-----------|
| LevelDB | 12× | - |
| RocksDB | 15× | -25% |
| PebblesDB | 4× | 67% |
| WiscKey | 1.2× | 90% |
| BlobDB | 2× | 83% |

**Read Performance (Random Point Query, KOps/s)**:
| System | Point Query Throughput | Relative to Baseline |
|--------|----------------------|---------------------|
| LevelDB | 25 | 100% |
| RocksDB | 30 | 120% |
| PebblesDB | 25 | 100% |
| WiscKey | 300 | 1200% |
| BlobDB | 37 | 150% |

**Space Efficiency (100GB Raw Data Actual Usage)**:
| System | Actual Usage | Space Amplification |
|--------|-------------|---------------------|
| LevelDB | 120 GB | 1.2× |
| RocksDB | 115 GB | 1.15× |
| WiscKey (After GC) | 102 GB | 1.02× |
| BlobDB | 105 GB | 1.05× |

**Optimization Benefits Summary**:
- **Key-value separation** is the most effective means to reduce write amplification (WiscKey/BlobDB)
- **Bloom Filter** is the most effective means to reduce read amplification (Reduce 90%+ invalid disk reads)
- **Compression algorithm** selection has significant impact on space efficiency (Zstd saves 30-50% space compared to Snappy)
- **Multi-threading** can significantly improve write throughput (RocksDB is 50%+ higher than LevelDB)

---

## Chapter 10: References and Further Reading

### 10.1 Core Papers

| Paper | Year | Core Contribution |
|-------|------|-------------------|
| *The Log-Structured Merge-Tree* | 1996 | LSM-Tree theoretical foundation |
| *WiscKey: Separating Keys from Values* | 2016 | Key-value separation optimization |
| *PebblesDB: Building Key-Value Stores using FLSM* | 2017 | FLSM data structure |
| *Bigtable: A Distributed Storage System* | 2006 | Distributed LSM practice |
| *The Five-Minute Rule Ten Years Later* | 2007 | Storage cost analysis |

### 10.2 Open Source Implementations

| Project | Language | Characteristics |
|---------|----------|-----------------|
| **LevelDB** | C++ | Most classic implementation, concise code |
| **RocksDB** | C++ | Industrial-grade, feature-rich |
| **Badger** | Go | WiscKey idea implementation |
| **Titan** | C++ | TiKV's key-value separation engine |
| **mini-lsm** | Rust | Educational, step-by-step implementation |
| **sled** | Rust | Pure Rust, modern design |

### 10.3 Recommended Books

| Title | Author | Focus |
|-------|--------|-------|
| *Designing Data-Intensive Applications* | Martin Kleppmann | Chapter 3 Storage and Retrieval |
| *Database Internals* | Alex Petrov | B-Tree vs LSM comparison |

---

## Appendix: Glossary

| Term | Explanation |
|------|-------------|
| **LSM** | Log-Structured Merge |
| **SSTable** | Sorted String Table |
| **MemTable** | In-memory table, write buffer |
| **Compaction** | Merge operation, maintains ordering |
| **Bloom Filter** | Bloom filter, fast exclusion for queries |
| **Tombstone** | Deletion marker |
| **MVCC** | Multi-Version Concurrency Control |
| **WAL** | Write-Ahead Log |
| **GC** | Garbage Collection |
| **vLog** | Value Log, value storage after key-value separation |
| **Guard** | Partition point for organizing sstables in PebblesDB |
| **FLSM** | Fragmented LSM, data structure proposed by PebblesDB |

---

*Document End*

