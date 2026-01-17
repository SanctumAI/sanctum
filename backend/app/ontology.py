"""
Sanctum Ontology Configuration
Modular ontology system - swap configs based on document domain.

Usage:
    from ontology import get_ontology, list_ontologies
    
    ontology = get_ontology("bitcoin_technical")  # or "human_rights", etc.
"""

from pydantic import BaseModel
from typing import Optional


class EntityType(BaseModel):
    """Definition of an entity type in the ontology"""
    name: str
    description: str
    properties: list[str]  # Expected properties for this entity type
    example: Optional[str] = None


class RelationshipType(BaseModel):
    """Definition of a relationship type in the ontology"""
    name: str
    description: str
    from_types: list[str]  # Valid source entity types
    to_types: list[str]    # Valid target entity types
    example: Optional[str] = None


class Ontology(BaseModel):
    """Complete ontology configuration for a domain"""
    id: str
    name: str
    description: str
    version: str
    entity_types: list[EntityType]
    relationship_types: list[RelationshipType]
    extraction_prompt: str  # LLM prompt template for this domain


# =============================================================================
# BITCOIN TECHNICAL PAPERS ONTOLOGY (DEFAULT)
# =============================================================================

BITCOIN_TECHNICAL_ONTOLOGY = Ontology(
    id="bitcoin_technical",
    name="Bitcoin Technical Papers",
    description="Ontology for Bitcoin whitepapers, BIPs, and technical documentation",
    version="1.0.0",
    entity_types=[
        EntityType(
            name="Concept",
            description="A technical concept or idea (e.g., 'proof-of-work', 'double-spending')",
            properties=["name", "definition", "category"],
            example="Proof-of-Work: A consensus mechanism requiring computational effort"
        ),
        EntityType(
            name="Protocol",
            description="A defined protocol or system (e.g., 'Bitcoin', 'Lightning Network')",
            properties=["name", "purpose", "version"],
            example="Bitcoin: A peer-to-peer electronic cash system"
        ),
        EntityType(
            name="Algorithm",
            description="A specific algorithm or method (e.g., 'SHA-256', 'ECDSA')",
            properties=["name", "type", "complexity"],
            example="SHA-256: Cryptographic hash function used for mining"
        ),
        EntityType(
            name="CryptographicPrimitive",
            description="Fundamental cryptographic building block",
            properties=["name", "type", "security_assumption"],
            example="Elliptic Curve Digital Signature Algorithm (ECDSA)"
        ),
        EntityType(
            name="AttackVector",
            description="A potential attack or vulnerability",
            properties=["name", "description", "mitigation"],
            example="51% Attack: Majority hashpower can rewrite blockchain history"
        ),
        EntityType(
            name="Component",
            description="A system component or data structure",
            properties=["name", "purpose", "structure"],
            example="Merkle Tree: Binary tree structure for efficient transaction verification"
        ),
        EntityType(
            name="Actor",
            description="A participant or role in the system",
            properties=["name", "role", "incentives"],
            example="Miner: Network participant who validates transactions"
        ),
        EntityType(
            name="Claim",
            description="A specific technical claim or assertion",
            properties=["text", "confidence", "source_location"],
            example="The system is secure as long as honest nodes control majority of CPU power"
        ),
    ],
    relationship_types=[
        RelationshipType(
            name="USES",
            description="One thing uses or depends on another",
            from_types=["Protocol", "Algorithm", "Component"],
            to_types=["Algorithm", "CryptographicPrimitive", "Component", "Concept"],
            example="Bitcoin USES SHA-256"
        ),
        RelationshipType(
            name="PREVENTS",
            description="One thing prevents or mitigates another",
            from_types=["Concept", "Algorithm", "Protocol", "Component"],
            to_types=["AttackVector"],
            example="Proof-of-Work PREVENTS double-spending"
        ),
        RelationshipType(
            name="ENABLES",
            description="One thing enables or makes possible another",
            from_types=["Concept", "Algorithm", "CryptographicPrimitive"],
            to_types=["Concept", "Protocol", "Component"],
            example="Digital signatures ENABLES trustless transactions"
        ),
        RelationshipType(
            name="COMPOSED_OF",
            description="One thing is composed of or contains another",
            from_types=["Protocol", "Component"],
            to_types=["Component", "Algorithm", "Concept"],
            example="Block COMPOSED_OF Merkle Tree"
        ),
        RelationshipType(
            name="PARTICIPATES_IN",
            description="An actor participates in a process or protocol",
            from_types=["Actor"],
            to_types=["Protocol", "Concept"],
            example="Miner PARTICIPATES_IN consensus"
        ),
        RelationshipType(
            name="EXPLOITS",
            description="An attack exploits a vulnerability or weakness",
            from_types=["AttackVector"],
            to_types=["Component", "Protocol", "Concept"],
            example="Sybil Attack EXPLOITS identity-free network"
        ),
        RelationshipType(
            name="SUPPORTED_BY",
            description="A claim is supported by a source or evidence",
            from_types=["Claim"],
            to_types=["Concept", "Algorithm", "Component"],
            example="Claim SUPPORTED_BY mathematical proof"
        ),
    ],
    extraction_prompt="""You are extracting structured knowledge from a Bitcoin/cryptocurrency technical document.

Given the following text chunk, extract:

1. ENTITIES - Technical concepts, protocols, algorithms, components, actors, and claims
2. RELATIONSHIPS - How these entities relate to each other

For each entity, identify:
- type: One of [Concept, Protocol, Algorithm, CryptographicPrimitive, AttackVector, Component, Actor, Claim]
- name: Clear identifier
- properties: Relevant attributes based on entity type

For each relationship, identify:
- type: One of [USES, PREVENTS, ENABLES, COMPOSED_OF, PARTICIPATES_IN, EXPLOITS, SUPPORTED_BY]
- from_entity: Source entity name
- to_entity: Target entity name
- evidence: Brief quote or reasoning from the text

Return as JSON:
{
  "entities": [
    {"type": "...", "name": "...", "properties": {...}}
  ],
  "relationships": [
    {"type": "...", "from_entity": "...", "to_entity": "...", "evidence": "..."}
  ]
}

TEXT CHUNK:
"""
)


# =============================================================================
# HUMAN RIGHTS ONTOLOGY (PLACEHOLDER)
# =============================================================================

HUMAN_RIGHTS_ONTOLOGY = Ontology(
    id="human_rights",
    name="Human Rights Documentation",
    description="Ontology for human rights reports, testimony, and legal documentation",
    version="0.1.0",
    entity_types=[
        EntityType(
            name="Claim",
            description="A specific factual assertion about an event or situation",
            properties=["text", "date", "confidence"],
            example="Detention occurred on March 15, 2024"
        ),
        EntityType(
            name="Actor",
            description="Individual or organization involved",
            properties=["name", "type", "role"],
            example="Organization X (perpetrator)"
        ),
        EntityType(
            name="Event",
            description="A specific incident or occurrence",
            properties=["description", "date", "location"],
            example="Protest dispersal on 2024-03-15"
        ),
        EntityType(
            name="Location",
            description="Geographic location",
            properties=["name", "type", "coordinates"],
            example="City Center, Country X"
        ),
        EntityType(
            name="Violation",
            description="Categorized human rights violation",
            properties=["type", "severity", "legal_basis"],
            example="Arbitrary Detention (ICCPR Art. 9)"
        ),
        EntityType(
            name="Source",
            description="Information source",
            properties=["type", "reliability", "date"],
            example="Witness testimony, high reliability"
        ),
        EntityType(
            name="LegalInstrument",
            description="Treaty, law, or convention",
            properties=["name", "jurisdiction", "articles"],
            example="ICCPR Article 9"
        ),
    ],
    relationship_types=[
        RelationshipType(
            name="SUPPORTED_BY",
            description="Claim supported by source",
            from_types=["Claim"],
            to_types=["Source"],
        ),
        RelationshipType(
            name="DESCRIBES",
            description="Claim describes an event",
            from_types=["Claim"],
            to_types=["Event"],
        ),
        RelationshipType(
            name="ALLEGES",
            description="Claim alleges a violation",
            from_types=["Claim"],
            to_types=["Violation"],
        ),
        RelationshipType(
            name="OCCURRED_AT",
            description="Event occurred at location",
            from_types=["Event"],
            to_types=["Location"],
        ),
        RelationshipType(
            name="INVOLVED",
            description="Event involved an actor",
            from_types=["Event"],
            to_types=["Actor"],
        ),
        RelationshipType(
            name="PERPETRATED",
            description="Actor perpetrated violation",
            from_types=["Actor"],
            to_types=["Violation"],
        ),
        RelationshipType(
            name="VIOLATES",
            description="Violation violates legal instrument",
            from_types=["Violation"],
            to_types=["LegalInstrument"],
        ),
    ],
    extraction_prompt="""You are extracting structured knowledge from a human rights document.

Given the following text chunk, extract entities and relationships according to the HURIDOCS "Who Did What to Whom" framework.

[Placeholder - to be refined with human rights expert input]

TEXT CHUNK:
"""
)


# =============================================================================
# ONTOLOGY REGISTRY
# =============================================================================

ONTOLOGY_REGISTRY: dict[str, Ontology] = {
    "bitcoin_technical": BITCOIN_TECHNICAL_ONTOLOGY,
    "human_rights": HUMAN_RIGHTS_ONTOLOGY,
}

DEFAULT_ONTOLOGY = "bitcoin_technical"


def get_ontology(ontology_id: str | None = None) -> Ontology:
    """Get an ontology by ID, or return the default"""
    if ontology_id is None:
        ontology_id = DEFAULT_ONTOLOGY
    
    if ontology_id not in ONTOLOGY_REGISTRY:
        raise ValueError(f"Unknown ontology: {ontology_id}. Available: {list(ONTOLOGY_REGISTRY.keys())}")
    
    return ONTOLOGY_REGISTRY[ontology_id]


def list_ontologies() -> list[dict]:
    """List all available ontologies"""
    return [
        {
            "id": ont.id,
            "name": ont.name,
            "description": ont.description,
            "version": ont.version,
            "entity_types": [e.name for e in ont.entity_types],
            "relationship_types": [r.name for r in ont.relationship_types],
        }
        for ont in ONTOLOGY_REGISTRY.values()
    ]


def register_ontology(ontology: Ontology) -> None:
    """Register a new ontology at runtime"""
    ONTOLOGY_REGISTRY[ontology.id] = ontology
