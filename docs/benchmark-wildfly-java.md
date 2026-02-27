# treenav-mcp Benchmark — wildfly

**Date:** 2026-02-27
**Root:** `/tmp/wildfly`
**Language filter:** java

## Indexing Performance

| Metric | Value |
|---|---|
| Files indexed | 9,950 |
| Parse time | 1.25s |
| Store load time | 2.27s |
| Files/second | 7,935 |
| Total nodes | 63,225 |
| Indexed terms | 142,989 |
| Total words | 3,432,268 |

## Symbol Extraction

| Metric | Value |
|---|---|
| Avg nodes/file | 6.4 |
| Median nodes/file | 5 |
| Max nodes/file | 348 |
| Files with 0 symbols | 0 (0.0%) |
| Files with only imports | 48 (0.5%) |

### Nodes by symbol kind

| Kind | Total nodes | Files containing |
|---|---|---|
| method | 41,729 | 9179 |
| class | 9,899 | 8501 |
| interface | 1,241 | 1222 |
| enum | 406 | 374 |

## Sample Files (top 10 by node count)

| File | Nodes | Description |
|---|---|---|
| `ejb3/src/main/java/org/jboss/as/ejb3/logging/EjbLogger.java` | 348 | 1 interface: EjbLogger |
| `ee/src/main/java/org/jboss/as/ee/logging/EeLogger.java` | 129 | 1 interface: EeLogger |
| `iiop-openjdk/src/main/java/org/wildfly/iiop/openjdk/logging/IIOPLogger.java` | 124 | 1 interface: IIOPLogger |
| `ejb3/src/main/java/org/jboss/as/ejb3/component/EJBComponentDescription.java` | 99 | 1 class: EJBComponentDescription |
| `jpa/hibernate7/src/main/java/org/wildfly/persistence/jipijapa/hibernate7/TransactionScopedStatelessSession.java` | 97 | 1 class: TransactionScopedStatelessSession |
| `messaging-activemq/subsystem/src/main/java/org/wildfly/extension/messaging/activemq/_private/MessagingLogger.java` | 96 | 1 interface: MessagingLogger |
| `messaging-activemq/subsystem/src/main/java/org/wildfly/extension/messaging/activemq/jms/ExternalConnectionFactoryConfiguration.java` | 95 | 1 class: ExternalConnectionFactoryConfiguration |
| `testsuite/integration/manualmode/src/test/java/org/jboss/as/test/manualmode/ejb/client/outbound/connection/security/ElytronRemoteOutboundConnectionTestCase.java` | 95 | 1 class: ElytronRemoteOutboundConnectionTestCase |
| `undertow/src/main/java/org/wildfly/extension/undertow/logging/UndertowLogger.java` | 94 | 1 interface: UndertowLogger |
| `testsuite/integration/basic/src/test/java/org/jboss/as/test/integration/ee/jmx/property/WithProperties.java` | 85 | 1 class: WithProperties |

## Search Quality

### Query: `transaction`

| Score | Symbol | Snippet |
|---|---|---|
| 91.9 | class TransactionSubsystemXMLPersister | …if (TransactionSubsystemRootResourceDefinition.BINDING.isMarshallable(node) \|\|  |
| 80.1 | method writeContent | …TransactionSubsystemRootResourceDefinition.RECOVERY_LISTENER.isMarshallable(nod |
| 61.3 | class TransactionalServiceImpl | …class TransactionalServiceImpl implements TransactionalService { private static |
| 59.7 | class TransactionalStatelessBean | @Remote(TransactionalRemote.class) @Stateless public class TransactionalStateles |
| 58.6 | class TransactionLeakResetContextHandle | …final TransactionManager transactionManager; private final Transaction transact |
| 57.7 | class TransactionalStatusByRegistry | @Stateless @Asynchronous @TransactionAttribute(TransactionAttributeType.SUPPORTS |
| 56.4 | class TransactionalStatefulBean | …rollbackOnlyBeforeCompletion = false; @Resource private SessionContext sessionC |
| 54.5 | method transactionIsolation |  private TransactionIsolation transactionIsolation() { switch (isolationLevel) { |

### Query: `stateless session bean`

| Score | Symbol | Snippet |
|---|---|---|
| 90.9 | class SessionBeanComponentDescriptionFactory | …: propertyReplacer.replaceProperties(nameValue.asString()); final SessionBeanMe |
| 80.6 | method processSessionBeans | …final String beanClassName; if (beanMetaData != null) { beanClassName = overrid |
| 79.4 | class ReferenceAnnotationDescriptorTestCase | …void testSessionHome30() throws Exception { InitialContext jndiContext = new In |
| 77.8 | method processSessionBeanMetaData | …{ //it is not a session bean, so we ignore it return; } } else if (sessionType  |
| 74.5 | class SessionBeanXmlDescriptorProcessor | …sessionBeanDescription.addEjbLocalObjectView(local); } final String remote = se |
| 72.9 | method testStatefulState | …home.create(); Assert.assertNotNull(session3); session3.setValue("123"); Assert |
| 69.7 | method test |  @Test public void test() { check(beanProducingAProcessorOfMessage); check(beanP |
| 69.3 | class Session30Bean | @Stateless(name = "Session30") @Remote(Session30RemoteBusiness.class) @Local(Loc |

### Query: `persistence`

| Score | Symbol | Snippet |
|---|---|---|
| 53.1 | class PersistenceUnitMetadataHolder | …Jakarta Persistence persistent units */ public static final AttachmentKey<Persi |
| 52.1 | class PersistenceProviderDeploymentHolder | …final List<PersistenceProvider> providerList, final List<PersistenceProviderAda |
| 51.6 | class PersistenceUnitsInApplication | public class PersistenceUnitsInApplication { public static final AttachmentKey<P |
| 46.7 | class PersistenceProviderAdaptorLoader | …persistence provider adaptor for the provider class */ public static Persistenc |
| 45.1 | class PersistenceProviderResolverImpl | public class PersistenceProviderResolverImpl implements PersistenceProviderResol |
| 45.0 | method PersistenceUnitServiceImpl |  public PersistenceUnitServiceImpl( final Map properties, final ClassLoader clas |
| 44.5 | method persistenceUnitUtil |  private void persistenceUnitUtil( AfterBeanDiscovery afterBeanDiscovery, Persis |
| 43.8 | class PersistenceCompleteInstallProcessor | …undeploy(DeploymentUnit context) { PersistenceUnitServiceHandler.undeploy(conte |

## Parser Coverage Notes

| Language | Parser | Class | Interface | Enum | Methods | Known gaps |
|---|---|---|---|---|---|---|
| Java | java.ts (dedicated) | ✓ | ✓ | ✓ | ✓ | Inner class members not recursed |
| TypeScript/JS | typescript.ts (dedicated) | ✓ | ✓ | ✓ | ✓ | — |
| Python | python.ts (dedicated) | ✓ | — | — | ✓ | — |
| Go | generic.ts | ✓ structs | ✓ interfaces | ✓ | ✓ receiver methods | impl blocks |
| Rust | generic.ts | ✓ structs | ✓ traits | ✓ | top-level fn only | impl blocks, pub(crate) fn |
| C++ | generic.ts | ✓ (top-level) | — | — | ✓ ClassName::method | Indented classes (namespaces) |
| C# / Kotlin / Scala | generic.ts | ✓ | ✓ | ✓ | ✗ (no fn keyword) | Methods inside classes |
