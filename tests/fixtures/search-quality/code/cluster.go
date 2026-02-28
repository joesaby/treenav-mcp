package cluster

import (
	"context"
	"fmt"
	"sync"
)

// NodeState represents the current state of a cluster node.
type NodeState string

const (
	StateConnected NodeState = "connected"
	StateOffline   NodeState = "offline"
)

var ErrNotConnected = fmt.Errorf("cluster node is not connected")

// NodeInfo holds metadata about a registered cluster node.
type NodeInfo struct {
	Address string
	Port    int
	State   NodeState
}

// ClusterInterface defines the contract for cluster node management.
type ClusterInterface interface {
	Connect(ctx context.Context, address string, port int) error
	Disconnect(address string) error
	GetNode(address string) (*NodeInfo, error)
}

// ClusterManager implements ClusterInterface using an in-memory map.
type ClusterManager struct {
	mu    sync.RWMutex
	nodes map[string]*NodeInfo
}

// NewClusterManager creates an empty ClusterManager.
func NewClusterManager() *ClusterManager {
	return &ClusterManager{
		nodes: make(map[string]*NodeInfo),
	}
}

// Connect registers a node as connected.
func (cm *ClusterManager) Connect(ctx context.Context, address string, port int) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.nodes[address] = &NodeInfo{Address: address, Port: port, State: StateConnected}
	return nil
}

// Disconnect removes a node from the cluster.
func (cm *ClusterManager) Disconnect(address string) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	if _, ok := cm.nodes[address]; !ok {
		return ErrNotConnected
	}
	delete(cm.nodes, address)
	return nil
}

// GetNode retrieves node info by address.
func (cm *ClusterManager) GetNode(address string) (*NodeInfo, error) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	node, ok := cm.nodes[address]
	if !ok {
		return nil, ErrNotConnected
	}
	return node, nil
}

func (cm *ClusterManager) activeNodes() []*NodeInfo {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	result := make([]*NodeInfo, 0, len(cm.nodes))
	for _, node := range cm.nodes {
		if node.State == StateConnected {
			result = append(result, node)
		}
	}
	return result
}
