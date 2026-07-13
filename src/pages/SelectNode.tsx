import { useEffect, useState, useCallback } from "react";
import Button from "../components/Button";
import Header from "../components/Header";
import useWallet from "../hooks/useWallet";
import NodeCard from "../components/NodeCard";
import { PRESET_NODES } from "../config/network";
import {
  isDefiNode,
  labelForNodeUrl,
  normalizeNodeUrl,
} from "../utils/nodes";
import { probeNode } from "../utils/warthogNode";

interface NodeType {
  id: number;
  name: string;
  address: string;
  status: string;
  latency: number;
  network: "mainnet" | "defi-testnet";
}

function SelectNode() {
  const {
    wallet,
    nodeList,
    nodeNameList,
    selectedNodeIndex,
    setSelectedNodeIndex,
    setNodeList,
    setNodeNameList,
  } = useWallet();

  const [nodes, setNodes] = useState<NodeType[]>([] as NodeType[]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newNodeAddress, setNewNodeAddress] = useState("");
  const [newNodeName, setNewNodeName] = useState("");
  const [warning, setWarning] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "mainnet" | "defi-testnet">("all");

  const filteredNodes = nodes.filter((node) => {
    if (filter !== "all" && node.network !== filter) return false;
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return (
      node.name.toLowerCase().includes(q) ||
      node.address.toLowerCase().includes(q)
    );
  });

  const setPrimaryNode = (id: number) => {
    setSelectedNodeIndex(id);
  };

  const removeNode = (id: number) => {
    // Keep at least one node
    if (nodeList.length <= 1) return;
    setNodeList(nodeList.filter((_, index) => index !== id));
    setNodeNameList(nodeNameList.filter((_, index) => index !== id));
    if (selectedNodeIndex >= id)
      setSelectedNodeIndex(Math.max(selectedNodeIndex - 1, 0));
  };

  const handleAddNode = () => {
    const urlPattern =
      /^(https?:\/\/)(([a-z0-9-]+\.)+[a-z]{2,}|(\d{1,3}\.){3}\d{1,3})(:\d{1,5})?(\/.*)?$/i;

    const normalized = normalizeNodeUrl(newNodeAddress);
    if (!normalized || !urlPattern.test(normalized)) {
      setWarning(true);
      return;
    }

    if (nodeList.some((n) => normalizeNodeUrl(n) === normalized)) {
      setWarning(true);
      return;
    }

    const len = nodeList.length;
    const name =
      newNodeName.trim() ||
      labelForNodeUrl(normalized) ||
      (isDefiNode(normalized) ? "Custom DeFi node" : "Custom node");
    setNodeList([...nodeList, normalized]);
    setNodeNameList([...nodeNameList, name]);
    setSelectedNodeIndex(len);
    setNewNodeName("");
    setNewNodeAddress("");
    setIsDialogOpen(false);
    setWarning(false);
  };

  const handleAddPresets = (network: "mainnet" | "defi-testnet") => {
    const toAdd = PRESET_NODES.filter((p) => p.network === network);
    let urls = [...nodeList];
    let names = [...nodeNameList];
    for (const p of toAdd) {
      const n = normalizeNodeUrl(p.url);
      if (!urls.some((u) => normalizeNodeUrl(u) === n)) {
        urls.push(n);
        names.push(p.name);
      }
    }
    setNodeList(urls);
    setNodeNameList(names);
  };

  const handleCancel = () => {
    setNewNodeAddress("");
    setNewNodeName("");
    setIsDialogOpen(false);
    setWarning(false);
  };

  const measureLatency = useCallback(
    async (address: string, index: number) => {
      const result = await probeNode(address, wallet);
      setNodes((prev) => {
        const newNodes = [...prev];
        if (!newNodes[index]) return prev;
        newNodes[index] = {
          ...newNodes[index],
          latency: result.latencyMs,
          status: result.online ? "online" : "offline",
        };
        return newNodes;
      });
    },
    [wallet],
  );

  useEffect(() => {
    if (nodeList.length === 0) {
      setNodes([]);
      return;
    }

    setNodes(
      nodeList.map((node, index) => ({
        id: index,
        name: nodeNameList[index] || labelForNodeUrl(node),
        address: node,
        status: "Checking",
        latency: 0,
        network: isDefiNode(node) ? "defi-testnet" : "mainnet",
      })),
    );

    nodeList.forEach((node, index) => {
      measureLatency(node, index);
    });

    const interval = setInterval(() => {
      nodeList.forEach((node, index) => {
        measureLatency(node, index);
      });
    }, 10_000);

    return () => clearInterval(interval);
  }, [measureLatency, nodeList, nodeNameList]);

  return (
    <div className="min-h-screen container relative px-4">
      <Header title="Select A Node" />

      <div className="flex gap-2 mb-3 flex-wrap">
        {(
          [
            ["all", "All"],
            ["mainnet", "Mainnet"],
            ["defi-testnet", "DeFi Testnet"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              filter === id
                ? "bg-primary/20 border-primary text-primary"
                : "border-white/20 text-white/60"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="relative w-full mb-2">
        <input
          className="h-14 w-full pl-12 pr-4 py-2 bg-primary/10 rounded-full border border-primary focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="Search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <img
          className="absolute left-4 top-1/2 transform -translate-y-1/2 w-6 h-6"
          src="icons/search-icon.svg"
          alt="Search Icon"
        />
      </div>

      <div className="flex gap-2 mb-3">
        <button
          type="button"
          className="text-xs text-primary underline"
          onClick={() => handleAddPresets("mainnet")}
        >
          + Mainnet presets
        </button>
        <button
          type="button"
          className="text-xs text-amber-300 underline"
          onClick={() => handleAddPresets("defi-testnet")}
        >
          + DeFi testnet presets
        </button>
      </div>

      <div className="h-[55vh] overflow-y-scroll">
        {filteredNodes.length > 0 ? (
          filteredNodes.map((node) => (
            <div key={node.id} className="relative">
              <span
                className={`absolute right-3 top-3 z-10 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  node.network === "defi-testnet"
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-emerald-500/15 text-emerald-300"
                }`}
              >
                {node.network === "defi-testnet" ? "DeFi" : "Mainnet"}
              </span>
              <NodeCard
                {...node}
                setPrimaryNode={setPrimaryNode}
                removeNode={removeNode}
              />
            </div>
          ))
        ) : (
          <div className="text-center text-white/50 mt-6">No nodes found</div>
        )}
      </div>

      <div className="absolute bottom-3 w-full left-0 px-4">
        <Button
          variant="primary"
          ariaLabel="Add Node"
          onClick={() => setIsDialogOpen(true)}
          className="w-full"
        >
          + Add more nodes
        </Button>
      </div>

      {isDialogOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-[#1A1A1A] p-4 rounded shadow-lg w-[300px]">
            <h3 className="text-white text-xl font-semibold mb-4">
              Add new Node
            </h3>
            <p className="text-white/50 text-xs mb-2">
              Mainnet example: https://warthognode.duckdns.org
              <br />
              DeFi testnet: https://warthog-defitestnet.duckdns.org
            </p>
            <input
              type="text"
              placeholder="Node Name"
              value={newNodeName}
              onChange={(e) => setNewNodeName(e.target.value)}
              className="w-full min-w-[150px] bg-[#2A2A2A] border border-primary/25 rounded-lg p-3 text-white focus:outline-none focus:border-primary mb-1"
            />
            <input
              type="text"
              placeholder="Node Address"
              value={newNodeAddress}
              onChange={(e) => {
                setNewNodeAddress(e.target.value);
                setWarning(false);
              }}
              className="w-full min-w-[150px] bg-[#2A2A2A] border border-primary/25 rounded-lg p-3 text-white focus:outline-none focus:border-primary"
            />
            {warning && (
              <p className="text-red-500 text-xs mt-1">
                Please enter a valid, unique node URL
              </p>
            )}
            <div className="flex justify-end mt-4">
              <Button
                variant="secondary"
                onClick={handleCancel}
                className="mr-2 w-full"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleAddNode}
                className="w-full"
              >
                Add
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SelectNode;
