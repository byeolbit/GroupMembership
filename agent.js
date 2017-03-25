var fs = require('fs');
var socket = require('socket.io-client')('http://localhost:3000');

var agentKind = ['Computer',
                 'SmartDevice',
                 'IoTDevice'];

var appDomain = ['Healthcare',
                 'Personal and Social',
                 'Transportation and logistics',
                 'Smart environment',];

var workDomain = ['Contents processing',
                  'Contents management'];

var agentOwner = ['Shaquita',
                  'Soledad',
                  'Mike',
                  'Alfonzo',
                  'Gertie',
                  'Roman',
                  'Nana',
                  'Velvet',
                  'Anisha',
                  'Malvina'];

var date = new Date();

function logGroupData() {
    //fs.writeFile('log/'+agent.id+'_'+date.getDate()+'_'+date.getHours()+'_'+date.getMinutes()+'_'+date.getMilliseconds()+'group.txt', JSON.stringify(groups, null, 2));
}

function logAgentData() {
    //fs.writeFile('log/'+agent.id+'_'+date.getDate()+'_'+date.getHours()+'_'+date.getMinutes()+'_'+date.getMilliseconds()+'agent.txt', JSON.stringify(agent.agentList,null,2));
}

function Agent(){
    var kind = agentKind[Math.floor(Math.random()*agentKind.length)];
    var owner = agentOwner[Math.floor(Math.random()*3)];
    var PROCESSING = 0;
    var MANAGEMENT = 1;

    this.id = Math.random().toString(36).substr(2, 20);
    this.kind = kind;

    if (kind === 'IoTDevice') {
        this.domain = appDomain[Math.floor(Math.random()*appDomain.length)];
        this.performance = getPerformance(1,15);
    } else if (kind === 'Computer') {
        this.domain = workDomain[PROCESSING];
        this.performance = getPerformance(1,15);
    } else if (kind === 'SmartDevice') {
        this.domain = workDomain[MANAGEMENT];
        this.performance = getPerformance(1,15);
    } else {
        throw new UserException('Invalid agent kind error!');
    }
    this.owener = owner;
    this.knownFamily = {};
    this.family = {
        name : owner,
        member : []
    };
    this.agentList = {};
    
    /** array of groupId */
    this.group = [];
    this.completedGroup = [];

    /** Get random number between a and b */
    function getPerformance(a, b) {
        return Math.floor(Math.random()*b)+a;
    }
}

var agent = new Agent();
var groups = {};

//Find new relationship
Agent.prototype.lookOthers = function(neighborList, socket) {
    for (var i in neighborList) {
        this.addNewAgent(neighborList[i]);
    }
    socket.emit('registerComplete',this.id);
}

/**
 * Impression : default(30) + Same kind(10) + same domain(10) + performance
 */
Agent.prototype.getImpression = function(neighbor) {
    var self = this;
    var attraction = 30;
    if (neighbor.kind === self.kind) {
        if (self.domain === neighbor.domain) {
            attraction += 20;
        } else {
            attraction += 10;
        }
    }
    
    attraction += neighbor.performance;

    return attraction;
}

Agent.prototype.addNewAgent = function(neighbor) {
    var self = this;
    if (self.agentList[neighbor.id] == undefined && self.id !== neighbor.id) {
        self.agentList[neighbor.id] = neighbor;
        self.agentList[neighbor.id].attraction = self.getImpression(neighbor);
        //socket.emit('alertJoinToNeighbor',{ id : neighbor.id, who : self.id });
        
        logAgentData();
        console.log('New agent added!');
        //console.log(self.agentList);
    }
}

Agent.prototype.setFamily = function(f) {
    if (this.family.name === f.name)
    this.family = {
        name : f.name,
        member : f.member
    }
}

Agent.prototype.updateFamily = function(list) {
    var self = this;
    this.family.member = list;

    //fs.writeFile('log/'+self.id+'_'+date.getDate()+'_'+date.getHours()+'_'+date.getMinutes()+'_'+date.getMilliseconds()+'family.txt', JSON.stringify(self.family,null,2));
        
    console.log('family update!');
    //console.log(this.family);
}

Agent.prototype.sendPublicInfo = function(socket) {
    var publicData = {
        id : this.id,
        kind : this.kind,
        performance : this.performance,
        owner : this.owener,
        domain : this.domain
    }
    socket.emit('replyToRegister',publicData);
}

Agent.prototype.makeGroup = function(work) {
    var newGroup = new Group(this, work);
    console.log(newGroup.id+' : group has generated!');
    groups[newGroup.id] = newGroup;
    socket.emit('registerNewGroup',newGroup);
    socket.emit('sendGroupInvitation',{
        groupId : newGroup.id, from : agent.id, group : newGroup
    });
    this.group.push(newGroup.id);
}

function Group(agent, work) {
    /** work.id, work.type, work.needs */
    var entry = {};
    var workLeft = {};
    var familyBackup = {};
    var normalBackup = {};
    var pending = {};

    for (var i in work.needs) {
        var result = findAvailableMemberByDomain(this, agent, i, work.needs[i], work.type, false);
        entry[i] = result.entry;
        workLeft[i] = result.workLeft;
        familyBackup[i] = result.backupFamily;
        normalBackup[i] = result.backupNormal;
    }

    this.id = work.id;
    this.type = work.type;
    this.entry = [agent.id];
    this.pending = entry;
    this.secondEntry = [];
    this.work = work;
    this.workLeft = workLeft;
    this.backup = {
        family : familyBackup,
        normal : normalBackup
    }
    this.rejects = [];
}

function findAvailableMemberByDomain(self, agent, domain, workSize, type, refresh) {
    /**1.family(performance) 2.attraction(performance) */
    var member;
    if (refresh === true) {
        var filteredList = filterAgents(agent, self.rejects, self.entry);
        member = classifyMembers(agent.agentList, type, domain, self);
    } else {
        member = classifyMembers(agent.agentList, type, domain, self);
    }
    member.family = sortMembers(member.family);
    member.normal = sortMembers(member.normal);

    var lastEntry = chooseMember (member.family, member.normal, workSize);

    return { entry : lastEntry.entry,
             secondEntry : lastEntry.secondEntry,
             workLeft : workSize,
             backupFamily : member.family,
             backupNormal : member.normal };

    function filterAgents(agent, rejects, entry) {
        var agentList = agent.agentList;
        var newList = {};
        var i = 0;
        for (var member in agentList) {
            var inRejects = rejects.filter(function(obj) {
                return obj.key === member;
            })[0];

            var inEntry = entry.filter(function(obj) {
                return obj.key === member;
            })[0];

            if ((inRejects === undefined) && (inEntry === undefined)) {
                newList[member] = agentList[member];
            }
        }
        return newList;
    }

    function chooseMember (family, normal, workSize) {
        var lastEntry = [];
        var secondEntry = [];
        for (var i in family) {
            if ((workSize - family[i].value) > 0) {
                workSize -= family[i].value;
                lastEntry.push(family[i]);
            } else {
                if (workSize > 0) {
                    lastEntry.push(family[i]);
                    workSize -= family[i].value;
                } else {
                    secondEntry.push(family[i]);
                }
            }
        }
        for (var i in normal) {
            if ((workSize - normal[i].perf) > 0) {
                workSize -= normal[i].perf;
                lastEntry.push(normal[i]);
            } else {
                if (workSize > 0) {
                    lastEntry.push(normal[i]);
                    workSize -= normal[i].perf;
                } else {
                    secondEntry.push(normal[i]);
                }
            }
        }
        return { entry:lastEntry, secondEntry:secondEntry ,work:workSize };
    }

    function classifyMembers (memberList, type, domain, self) {
        var familyMember = [];
        var normalMember = [];

        for (var i in memberList) {
            if (hasDomain(memberList[i],domain)) {
                if (isFamily(agent, memberList[i])) {
                    familyMember.push({
                        key : memberList[i].id,
                        value : memberList[i].performance
                    });
                } else {
                    if (type === 'Public'){
                        normalMember.push({
                            key : memberList[i].id,
                            value : memberList[i].attraction,
                            perf : memberList[i].performance
                        });
                    }
                }
            }
        }
        return { family : familyMember, normal : normalMember };
    }

    function sortMembers (memberList) {
        memberList.sort(function(a,b){
            return a[1]-b[1];
        });
        return memberList;
    }

    function hasDomain (member, d) {
        return member.domain === d;
    }

}

function isFamily (agent, m) {
    return agent.family.member.indexOf(m.id) != -1;
}

/** 
 * Send approve msg if attraction is equal than average
 * Or it's family duty, must approve.
 * */
Agent.prototype.replyGroupInvitation = function(groupId, from, group) {
    if (this.agentList[from] === undefined) {
        console.log(this.id + ':' + from+' is unknown agent')
        return;
    }
    var attr = this.agentList[from].attraction;
    var attrList = [];
    for (var i in this.agentList) {
        attrList.push(this.agentList[i].attraction);
    }
    var stdDev = this.standardDeviation(attrList);
    var avg = average(attrList);
    var stanine = getStanine(attr, stdDev, avg);

    if ( (this.owner === this.agentList[from].owner) ||
          stanine >= 3)  {
        groups[groupId] = group;
        socket.emit('acceptGroupInvitation', {
            group : groupId,
            from : this.id,
            to: from
        });
        console.log('accept to invite!');
    } else {
        socket.emit('rejectGroupInvitation',{
            group : groupId,
            from : this.id,
            to: from
        });
        console.log('reject to invite! : '+stanine);
    }

    function getStanine (attr, stdDev, avg) {
        const STDDEV = 6.68;
        const AVG = 41.2;
        var z = (attr-avg)/stdDev;
        var stanine = (2*z + 5);
        return stanine;
    }
}

Agent.prototype.standardDeviation = function(values) {
    var avg = this.getAverageAttraction(this.agentList);
    
    var squareDiffs = values.map(value => {
        var diff = value - avg;
        var sqrDiff = diff * diff;
        return sqrDiff;
    });

    var avgSquareDiff = average(squareDiffs);
    var stdDev = Math.sqrt(avgSquareDiff);
    
    return stdDev;
}

Agent.prototype.getAverageAttraction = function(agentList) {
    var sum = 0;
    for (var i in agentList) {
        sum += agentList[i].attraction;
    }
    return sum/Object.keys(this.agentList).length;
}

function average(data){
    var sum = data.reduce(function(sum, value){
        return sum + value;
    }, 0);

    var avg = sum / data.length;
    return avg;
}

/** Host side part */
Agent.prototype.acceptGroupInvitation = function(data) {
    /** data.group, data.from(guest), data.to(team maker) */
    if(groups[data.group] === undefined) {
        console.log('aGI parm : ' + data);
        console.log('aGI this group : ' + groups[data.group]);
        return;
    }

    groups[data.group].entry.push(data.from);
    var d = this.agentList[data.from].domain;
    groups[data.group].pending[d].splice(
        findMemberInPending(data.from, groups[data.group].pending[d]));

    this.agentList[data.from].attraction += 2;

    var a = this.agentList[data.from];
    groups[data.group].workLeft[a.domain] -= a.performance;
    
    function findMemberInPending (member, list) {
        var len = list.length;
        for (var i = 0 ; i<len ; i++) {
            if(list[i].key === member)
                return i;
        }
        return -1;
    }
    socket.emit('updateGroupData',groups[data.group]);
    socket.emit('newGroupMember',{
        groupId : groups[data.group].id, from : data.from
    });
    checkLeftEntry(data.group);
    logGroupData();
    console.log(data.from+'accepted invitation');
}

/** reject message arrived from others */
Agent.prototype.rejectGroupInvitation = function(data) {
    /** data.group, data.from */
    var d = this.agentList[data.from].domain;
    if(groups[data.group] === undefined) {
        console.log(this.id+'rGI parm : ');
        console.log(this.id+data);
        console.log(this.id+'rGI this group : ');
        console.log(this.id+groups[data.group]);
        return;
    }
    var removed = groups[data.group].pending[d].splice(
        findMemberInPending(data.from, groups[data.group].pending[d]));

    groups[data.group].rejects.push(removed);
    this.agentList[data.from].attraction -= 2;
    
    function findMemberInPending (member, list) {
        var len = list.length;
        for (var i = 0 ; i<len ; i++) {
            if(list[i].key === member)
                return i;
        }
        return -1;
    }
    socket.emit('updateGroupData',groups[data.group]);
    checkLeftEntry(data.group);
}

function checkLeftEntry (groupId) {
    /**  */
    var cnt = 0;
    for (var i in groups[groupId].pending) {
        if (groups[groupId].pending[i].length == 0){
            if (groups[groupId].workLeft[i] > 0) {
                cnt++;
            } 
        }
    }
    if (cnt > 0 ) {
        refreshGroupEntry(groupId);
    } else {
        completeGroupWork(groupId);
    }
    logGroupData();
}

function completeGroupWork (groupId) {
    agent.completedGroup.push(groups[groupId]);
    socket.emit('completeGroupWork',groupId);
    console.log(groupId + 'has completed!');
    delete groups[groupId];
    agent.group.splice(agent.group.indexOf(groupId));
}

function deletegroup(groupId) {
    delete groups[groupId];
    agent.group.splice(agent.group.indexOf(groupId));
}

function refreshGroupEntry (groupId) {
    var g = groups[groupId];
    if (g === undefined) {
        console.log('cannnot find group'+groupId);
        return;
    }
    
    for (var i in g.work.needs) {
        var result = findAvailableMemberByDomain(g, agent, i, g.workLeft[i], g.work.type, true);
        g.pending[i] = result.entry;
        g.backup.family[i] = result.backupFamily;
        g.backup.normal[i] = result.backupNormal;
    }

    socket.emit('updateGroupData',g);
    socket.emit('sendGroupInvitation',{
        groupId : g.id, from : agent.id, group : groups[groupId]
    });
}

Agent.prototype.newGroupMember = function(noob) {
    if(this.agentList[noob] === undefined) {
        console.log(this.id + ': ' +this.agentList);
        console.log(this.id + ': ' + noob + ' is not in the list');
        return;
    }
    this.agentList[noob].attraction += 1;
}

function updateGroup (group) {
    groups[group.id] = group;
    logGroupData();
    logAgentData();
}

socket.on('registerToNetwork', () => {
    agent.sendPublicInfo(socket);
});

socket.on('updateFamilyMembers', members => {
    agent.updateFamily(members);
});

socket.on('familySet', familyData => {
    agent.setFamily(familyData);
});

socket.on('connectAccepted',() => {
    console.log('Connected to society!');
    //console.log(agent);
    socket.emit('requestAgentList');
});

socket.on('replyAgentList',list => {
    agent.lookOthers(list,socket);
});

socket.on('newAgent', newbe => {
    agent.addNewAgent(newbe);
});

socket.on('newNeighbor', (neighbor) => {
    agent.addNewAgent(neighbor);
});

//Recieve new work from owner
socket.on('newWork',(work) => {
    agent.makeGroup(work);
});

socket.on('newNeighbor', (neighbor) => {
    agent.addNewAgent(neighbor)
});

socket.on('requestGroupInvitation', (data) => {
    agent.replyGroupInvitation(data.groupId, data.from, data.group);
});

socket.on('rejectGroupInvitation', data => {
    agent.rejectGroupInvitation(data);
});

socket.on('acceptGroupInvitation', (data)=> {
    agent.acceptGroupInvitation(data);
});

socket.on('updateGroup',group => {
    updateGroup(group);
});

socket.on('newGroupMember', (noob) => {
    agent.newGroupMember(noob);
});

socket.on('completeGroupWork', groupId => {
    deletegroup(groupId);
});

socket.on('disconnect', function(msg) {
    socket.disconnect();
    //console.log(msg);
});