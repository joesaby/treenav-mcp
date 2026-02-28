package cluster

import (
	"context"
	"fmt"
	"sync"
)

var ErrNotConnected = fmt.Errorf("cluster node is not connected")

type NodeInfo struct {
	Address string
	Port    int
	State   string
}

type ClusterInterface interface {
	Connect(ctx context.Context, address string, port int) error
	Disconnect(address string) error
	GetNode(address string) (*NodeInfo, error)
}

type ClusterManager struct {
	mu    sync.RWMutex
	nodes map[string]*NodeInfo
}

func NewClusterManager() *ClusterManager {
	return &ClusterManager{
		nodes: make(map[string]*NodeInfo),
	}
}

func (cm *ClusterManager) Connect(ctx context.Context, address string, port int) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.nodes[address] = &NodeInfo{Address: address, Port: port, State: "connected"}
	return nil
}

func (cm *ClusterManager) Disconnect(address string) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	if _, ok := cm.nodes[address]; !ok {
		return ErrNotConnected
	}
	delete(cm.nodes, address)
	return nil
}

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
		if node.State == "connected" {
			result = append(result, node)
		}
	}
	return result
}
